import type { Shop } from "@prisma/client";
import type { Redis } from "ioredis";
import { labelFor, type SortOptionConfig } from "../config/sort-options";
import type { FilterItem } from "../config/filters";
import type { SearchSettingsConfig } from "../config/search-settings";
import { rkey } from "../redis.server";
import type { SearchEngine } from "../search/engine";
import { contentAlias, productAlias, stopwordsId } from "../search/names";
import type { SortDefaults } from "../search/query/sort";
import {
  loadShopConfig,
  shopFeatures,
  shopMarkets,
  type Db,
  type MarketInfo,
  type ShopFeatures,
} from "../shop/shop.server";

// Ngữ cảnh shop cho search-api: Shop + cấu hình đã gộp mặc định + redirect + stopword, cache 2 tầng
// (bộ nhớ process ~30 s, Redis 5 phút). Admin lưu → purgeShopConfig (mục 6.1 /config, mục 9).

export type ShopSearchContext = {
  shop: Pick<
    Shop,
    | "id"
    | "domain"
    | "publicKey"
    | "currency"
    | "primaryLocale"
    | "locales"
    | "plan"
    | "storefrontDomains"
    | "searchKeyScoped"
    | "uninstalledAt"
  >;
  features: ShopFeatures;
  markets: MarketInfo[];
  settings: SearchSettingsConfig;
  sortOptions: SortOptionConfig[];
  sortDefaults: SortDefaults;
  filters: {
    default: FilterItem[];
    search?: FilterItem[];
    collections: Record<string, FilterItem[]>;
  };
  /** queryKey → url */
  redirects: Record<string, string>;
  /** Locale có stopword (`sw_{shop}_{locale}`). */
  stopwordLocales: string[];
  appearance: {
    tokens: Record<string, unknown>;
    texts: Record<string, unknown>;
    templates: Record<string, string>;
  };
  /** Field có thật trong index hiện tại (bỏ trường metafield chưa re-index). */
  indexedFields: string[];
  productIndex: string;
  contentIndex: string;
  /** Mã phiên bản cấu hình (ETag / cache key SDK). */
  version: string;
};

type Cached = { at: number; ctx: ShopSearchContext };
const memory = new Map<string, Cached>();
const MEMORY_TTL_MS = 30_000;
const REDIS_TTL_S = 300;

const cacheKey = (domain: string) => rkey("cfg", domain);

export async function buildShopContext(
  db: Db,
  engine: SearchEngine,
  shop: Shop,
): Promise<ShopSearchContext> {
  const [config, redirects, stops, appearance] = await Promise.all([
    loadShopConfig(db, shop.id),
    db.redirect.findMany({ where: { shopId: shop.id }, select: { query: true, url: true } }),
    db.stopWord.findMany({
      where: { shopId: shop.id },
      select: { locale: true },
      distinct: ["locale"],
    }),
    db.appearance.findUnique({ where: { shopId: shop.id } }),
  ]);
  const col = await engine.getCollection(productAlias(shop.id)).catch(() => null);
  const ctx: ShopSearchContext = {
    shop: {
      id: shop.id,
      domain: shop.domain,
      publicKey: shop.publicKey,
      currency: shop.currency,
      primaryLocale: shop.primaryLocale,
      locales: shop.locales,
      plan: shop.plan,
      searchKeyScoped: shop.searchKeyScoped,
      uninstalledAt: shop.uninstalledAt,
      storefrontDomains: shop.storefrontDomains,
    },
    features: shopFeatures(shop),
    markets: shopMarkets(shop),
    ...config,
    redirects: Object.fromEntries(redirects.map((r) => [r.query, r.url])),
    stopwordLocales: stops.map((s) => s.locale),
    appearance: {
      tokens: (appearance?.tokens ?? {}) as Record<string, unknown>,
      texts: (appearance?.texts ?? {}) as Record<string, unknown>,
      templates: (appearance?.templates ?? {}) as Record<string, string>,
    },
    indexedFields: col?.fields.map((f) => f.name) ?? [],
    productIndex: productAlias(shop.id),
    contentIndex: contentAlias(shop.id),
    version: `${shop.updatedAt.getTime().toString(36)}-${Date.now().toString(36)}`,
  };
  return ctx;
}

export type ContextDeps = { db: Db; engine: SearchEngine; redis?: Redis; now?: () => number };

/** Single-flight: nhiều request cùng shop lúc cache nguội chỉ dựng ngữ cảnh MỘT lần (tải 6.2: hàng trăm request
 *  đồng thời từng làm cạn pool Postgres — "too many clients"). */
const inflight = new Map<string, Promise<ShopSearchContext | null>>();

export async function getShopContext(
  domain: string,
  deps: ContextDeps,
): Promise<ShopSearchContext | null> {
  const now = deps.now?.() ?? Date.now();
  const hit = memory.get(domain);
  if (hit && now - hit.at < MEMORY_TTL_MS) return hit.ctx;
  const pending = inflight.get(domain);
  if (pending) return pending;
  const p = loadShopContext(domain, deps, now).finally(() => inflight.delete(domain));
  inflight.set(domain, p);
  return p;
}

async function loadShopContext(
  domain: string,
  deps: ContextDeps,
  now: number,
): Promise<ShopSearchContext | null> {
  if (deps.redis) {
    const raw = await deps.redis.get(cacheKey(domain)).catch(() => null);
    if (raw) {
      const ctx = JSON.parse(raw) as ShopSearchContext;
      memory.set(domain, { at: now, ctx });
      return ctx;
    }
  }
  const shop = await deps.db.shop.findUnique({ where: { domain } });
  if (!shop || shop.uninstalledAt) return null;
  const ctx = await buildShopContext(deps.db, deps.engine, shop);
  memory.set(domain, { at: now, ctx });
  await deps.redis
    ?.set(cacheKey(domain), JSON.stringify(ctx), "EX", REDIS_TTL_S)
    .catch(() => undefined);
  return ctx;
}

/** Gọi khi merchant lưu cấu hình (admin) — xoá cache Redis; process khác hết hạn sau ≤ 30 s. */
export async function purgeShopConfig(domain: string, redis?: Redis) {
  memory.delete(domain);
  await redis?.del(cacheKey(domain)).catch(() => undefined);
}

export function clearContextMemory() {
  memory.clear();
}

export function stopwordsFor(ctx: ShopSearchContext, locale: string): string | undefined {
  const base = locale.split("-")[0];
  const l = ctx.stopwordLocales.find((x) => x === locale || x === base);
  return l ? stopwordsId(ctx.shop.id, l) : undefined;
}

/** Market có giá cố định cho country (phương án B, chỉ khi bật flag). */
export function fixedPriceMarket(
  ctx: ShopSearchContext,
  country?: string | null,
): MarketInfo | undefined {
  if (!country || !ctx.features.fixedMarketPrices) return undefined;
  const c = country.toUpperCase();
  return ctx.markets.find((m) => m.hasFixedPrices && m.countries.includes(c));
}

export function localizedSortOptions(ctx: ShopSearchContext, locale: string) {
  return ctx.sortOptions
    .filter((o) => o.enabled)
    .sort((a, b) => a.position - b.position)
    .map((o) => ({ key: o.key, label: labelFor(o.label, locale, o.key) }));
}
