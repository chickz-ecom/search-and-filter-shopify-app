import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient, Shop } from "@prisma/client";
import { DEFAULT_FILTERS, FilterItemsSchema, type FilterItem } from "../config/filters";
import {
  normalizeSearchFields,
  parseMetafieldKey,
  isMetafieldKey,
  type SearchField,
} from "../config/search-fields";
import {
  defaultSearchSettings,
  SearchSettingsSchema,
  type SearchSettingsConfig,
} from "../config/search-settings";
import {
  DEFAULT_SORT_OPTIONS,
  isMetafieldSortKey,
  parseMetafieldSortKey,
  type SortKey,
  type SortOptionConfig,
} from "../config/sort-options";
import { productAlias } from "../search/names";
import type { SortDefaults } from "../search/query/sort";
import type { MetafieldRef } from "../sync/queries";

export type Db = PrismaClient;

/** ID shop dùng trong tên tài nguyên engine (D6) → chỉ [a-z0-9]. */
export function newShopId(): string {
  return "s" + BigInt("0x" + randomBytes(10).toString("hex")).toString(36);
}

/** Public key cho SDK/Headless API (không phải bí mật — định danh shop + giới hạn rate). */
export function newPublicKey(): string {
  return "pk_" + randomBytes(18).toString("base64url");
}

export async function getShopByDomain(db: Db, domain: string) {
  return db.shop.findUnique({ where: { domain } });
}

export async function getShopByPublicKey(db: Db, publicKey: string) {
  return db.shop.findUnique({ where: { publicKey } });
}

/** Tạo shop lần đầu (hoặc kích hoạt lại khi cài lại) và seed cấu hình mặc định. */
export async function ensureShop(
  db: Db,
  domain: string,
  info: { currency?: string; primaryLocale?: string; locales?: string[]; domains?: string[] } = {},
): Promise<{ shop: Shop; created: boolean; reinstalled: boolean }> {
  const existing = await db.shop.findUnique({ where: { domain } });
  if (existing) {
    const reinstalled = Boolean(existing.uninstalledAt);
    const shop = await db.shop.update({
      where: { id: existing.id },
      data: {
        uninstalledAt: null,
        ...(reinstalled ? { installedAt: new Date() } : {}),
        ...(info.currency ? { currency: info.currency } : {}),
        ...(info.primaryLocale ? { primaryLocale: info.primaryLocale } : {}),
        ...(info.locales ? { locales: info.locales } : {}),
        ...(info.domains ? { storefrontDomains: info.domains } : {}),
      },
    });
    await seedDefaults(db, shop.id);
    return { shop, created: false, reinstalled };
  }
  const id = newShopId();
  const shop = await db.shop.create({
    data: {
      id,
      domain,
      publicKey: newPublicKey(),
      indexAlias: productAlias(id),
      currency: info.currency ?? "USD",
      primaryLocale: info.primaryLocale ?? "en",
      locales: info.locales ?? [],
      storefrontDomains: info.domains ?? [domain],
    },
  });
  await seedDefaults(db, shop.id);
  return { shop, created: true, reinstalled: false };
}

/** Idempotent: chỉ tạo phần còn thiếu. */
export async function seedDefaults(db: Db, shopId: string) {
  const d = defaultSearchSettings();
  await db.searchSettings.upsert({
    where: { shopId },
    update: {},
    create: {
      shopId,
      fields: d.fields as unknown as Prisma.InputJsonValue,
      searchTypes: d.searchTypes as unknown as Prisma.InputJsonValue,
      matchMode: d.matchMode,
      relevanceTieBreak: d.relevanceTieBreak,
    },
  });
  const existing = await db.sortOption.count({ where: { shopId } });
  if (!existing) {
    await db.sortOption.createMany({
      data: DEFAULT_SORT_OPTIONS.map((o) => ({
        shopId,
        key: o.key,
        label: o.label,
        enabled: o.enabled,
        position: o.position,
      })),
      skipDuplicates: true,
    });
  }
  await db.filterSet.upsert({
    where: { shopId_scope_collectionId: { shopId, scope: "DEFAULT", collectionId: "" } },
    update: {},
    create: {
      shopId,
      scope: "DEFAULT",
      collectionId: "",
      items: DEFAULT_FILTERS as unknown as Prisma.InputJsonValue,
    },
  });
}

export type ShopConfig = {
  settings: SearchSettingsConfig;
  sortOptions: SortOptionConfig[];
  sortDefaults: SortDefaults;
  filters: {
    default: FilterItem[];
    search?: FilterItem[];
    collections: Record<string, FilterItem[]>;
  };
};

function parseFilters(json: unknown): FilterItem[] {
  const r = FilterItemsSchema.safeParse(json);
  return r.success ? r.data : DEFAULT_FILTERS;
}

/** Cấu hình đầy đủ, đã gộp mặc định và validate (dữ liệu hỏng → mặc định, không làm sập search). */
export async function loadShopConfig(db: Db, shopId: string): Promise<ShopConfig> {
  const [settingsRow, sortRows, defaultRows, filterRows] = await Promise.all([
    db.searchSettings.findUnique({ where: { shopId } }),
    db.sortOption.findMany({ where: { shopId }, orderBy: { position: "asc" } }),
    db.sortDefault.findMany({ where: { shopId } }),
    db.filterSet.findMany({ where: { shopId } }),
  ]);

  let settings = defaultSearchSettings();
  if (settingsRow) {
    const candidate = {
      ...settings,
      ...settingsRow,
      fields: normalizeSearchFields(settingsRow.fields as unknown as SearchField[]),
      searchTypes: settingsRow.searchTypes ?? settings.searchTypes,
    };
    const parsed = SearchSettingsSchema.safeParse(candidate);
    if (parsed.success) settings = parsed.data;
  }

  const sortOptions: SortOptionConfig[] = sortRows.length
    ? sortRows.map((r) => ({
        key: r.key as SortKey,
        label: r.label as Record<string, string>,
        enabled: r.enabled,
        position: r.position,
      }))
    : DEFAULT_SORT_OPTIONS;

  const sortDefaults: SortDefaults = { collections: {} };
  for (const r of defaultRows) {
    if (r.scope === "SEARCH") sortDefaults.search = r.sortKey as SortKey;
    else if (r.scope === "COLLECTION_DEFAULT")
      sortDefaults.collectionDefault = r.sortKey as SortKey;
    else if (r.collectionId) sortDefaults.collections![r.collectionId] = r.sortKey as SortKey;
  }

  const filters: ShopConfig["filters"] = { default: DEFAULT_FILTERS, collections: {} };
  for (const r of filterRows) {
    const items = parseFilters(r.items);
    if (r.scope === "DEFAULT") filters.default = items;
    else if (r.scope === "SEARCH") filters.search = items;
    else if (r.collectionId) filters.collections[r.collectionId] = items;
  }
  return { settings, sortOptions, sortDefaults, filters };
}

/**
 * Metafield cần có trong document: trường search (mf:), filter metafield, sort theo metafield.
 * Thứ tự ổn định (sort) để alias mf_0..n không đổi giữa các lần chạy.
 */
export function requiredMetafields(config: ShopConfig): MetafieldRef[] {
  const set = new Map<string, MetafieldRef>();
  const add = (namespace: string, key: string) =>
    set.set(`${namespace}.${key}`, { namespace, key });
  for (const f of config.settings.fields) {
    if (isMetafieldKey(f.key)) {
      const m = parseMetafieldKey(f.key);
      add(m.namespace, m.key);
    }
  }
  const allFilters = [
    config.filters.default,
    config.filters.search ?? [],
    ...Object.values(config.filters.collections),
  ];
  for (const items of allFilters) {
    for (const it of items) {
      if (it.source === "metafield" && it.metafield) {
        const [ns, key] = it.metafield.split(".");
        add(ns, key);
      }
    }
  }
  for (const o of config.sortOptions) {
    if (isMetafieldSortKey(o.key)) {
      const m = parseMetafieldSortKey(o.key);
      add(m.namespace, m.key);
    }
  }
  return [...set.values()].sort((a, b) =>
    `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`),
  );
}

export type ShopFeatures = { fixedMarketPrices?: boolean; headless?: boolean };

export function shopFeatures(shop: Pick<Shop, "features">): ShopFeatures {
  return (shop.features ?? {}) as ShopFeatures;
}

export type MarketInfo = {
  handle: string;
  countries: string[];
  currency: string;
  hasFixedPrices: boolean;
};

export function shopMarkets(shop: Pick<Shop, "markets">): MarketInfo[] {
  return Array.isArray(shop.markets) ? (shop.markets as unknown as MarketInfo[]) : [];
}

/** Phương án B: country có price list cố định, chỉ khi bật flag fixedMarketPrices (tối đa 10 để giữ query nhẹ). */
export function fixedPriceCountries(shop: Pick<Shop, "features" | "markets">): string[] {
  if (!shopFeatures(shop).fixedMarketPrices) return [];
  return [
    ...new Set(
      shopMarkets(shop)
        .filter((m) => m.hasFixedPrices)
        .flatMap((m) => m.countries),
    ),
  ]
    .sort()
    .slice(0, 10);
}
