import { Hono, type Context } from "hono";
import type { Redis } from "ioredis";
import { headlessDecision, planById } from "../../../app/lib/billing/plans";
import { EngineUnavailableError, type SearchEngine } from "../../../app/lib/search/engine";
import type { ContentDoc } from "../../../app/lib/search/product-doc";
import { parseFilterParams, type AppliedFilters } from "../../../app/lib/search/query/filters";
import {
  recordEvents,
  type AnalyticsEvent,
} from "../../../app/lib/search-service/analytics.server";
import {
  getShopContext,
  purgeShopConfig,
  type ShopSearchContext,
} from "../../../app/lib/search-service/context.server";
import {
  MicroCache,
  originKind,
  RateLimiter,
  safeEqual,
} from "../../../app/lib/search-service/http-utils";
import { buildPublicConfig } from "../../../app/lib/search-service/public-config.server";
import { executeSearch, filtersForScope } from "../../../app/lib/search-service/search.server";
import { executeSuggest } from "../../../app/lib/search-service/suggest.server";
import type { Db } from "../../../app/lib/shop/shop.server";

const HEADLESS_ERRORS = {
  not_in_plan: "Headless API requires the Pro plan or higher",
  disabled: "Turn on headless access in the app's Developers page",
  origin_not_allowed: "This origin isn't in the shop's allowed headless origins",
} as const;

// Search API công khai (D9, mục 6.1). Stateless; mọi state ở Postgres/Redis/Typesense.
// Bảo mật: shop + publicKey, scoped Typesense key theo shop, rate limit theo IP và shop, CORS theo domain shop.
// Engine lỗi → 503 để client giữ kết quả native (D11).

export type SearchApiDeps = {
  db: Db;
  redis?: Redis;
  /** Engine dùng scoped key của shop (fallback key search-only chung). */
  engineFor: (ctx: ShopSearchContext) => SearchEngine;
  /** Engine chung (đọc schema khi dựng ngữ cảnh shop). */
  defaultEngine: SearchEngine;
  internalSecret?: string;
  redisPrefix?: string;
  ipRpm?: number;
  /** Bỏ qua kiểm tra publicKey (route app proxy đã xác thực chữ ký Shopify). */
  trustedShopHeader?: string;
};

type Vars = {
  ctx: ShopSearchContext;
  engine: SearchEngine;
  locale: string;
  country: string | null;
};

const CACHE_HEADER = "public, max-age=30, stale-while-revalidate=300";

function parseJsonFilters(raw: string | undefined): AppliedFilters | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: AppliedFilters = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "boolean") out[k] = val;
      else if (Array.isArray(val)) out[k] = val.map(String).slice(0, 50);
      else if (val && typeof val === "object") {
        const r = val as { min?: unknown; max?: unknown };
        out[k] = {
          ...(r.min !== undefined && Number.isFinite(Number(r.min)) ? { min: Number(r.min) } : {}),
          ...(r.max !== undefined && Number.isFinite(Number(r.max)) ? { max: Number(r.max) } : {}),
        };
      }
    }
    return out;
  } catch {
    return null;
  }
}

function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

export function createSearchApi(deps: SearchApiDeps) {
  const app = new Hono<{ Variables: Vars }>();
  const limiter = new RateLimiter(deps.redis, deps.redisPrefix ?? "sa");
  const cache = new MicroCache<{ body: unknown; status: number }>(5000, 10_000);
  const collectionCache = new MicroCache<{
    id: string;
    handle: string;
    sortOrder: string | null;
  } | null>(5000, 60_000);

  app.onError((err, c) => {
    if (err instanceof EngineUnavailableError) {
      c.header("Cache-Control", "no-store");
      c.header("Retry-After", "5");
      return c.json({ error: "engine_unavailable" }, 503);
    }
    console.error("[search-api]", err);
    c.header("Cache-Control", "no-store");
    return c.json({ error: "internal_error" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/internal/purge", async (c) => {
    if (
      !deps.internalSecret ||
      !safeEqual(c.req.header("x-internal-secret") ?? "", deps.internalSecret)
    ) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const { shop } = (await c.req.json().catch(() => ({}))) as { shop?: string };
    if (!shop) return c.json({ error: "shop required" }, 400);
    await purgeShopConfig(shop, deps.redis);
    cache.deletePrefix(`${shop}|`);
    collectionCache.deletePrefix(`${shop}|`);
    return c.json({ ok: true });
  });

  // CORS + auth + rate limit cho /v1/*
  app.use("/v1/*", async (c, next) => {
    const origin = c.req.header("origin") ?? null;
    const trusted = deps.trustedShopHeader ? c.req.header(deps.trustedShopHeader) : undefined;
    const shopDomain = (trusted ?? c.req.query("shop") ?? "").toLowerCase();
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Origin", origin ?? "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      c.header("Access-Control-Max-Age", "86400");
      c.header("Vary", "Origin");
      return c.body(null, 204);
    }
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain))
      return c.json({ error: "invalid_shop" }, 400);

    const ip = clientIp(c);
    const ipRate = await limiter.hit(`ip:${ip}`, deps.ipRpm ?? 600);
    if (!ipRate.allowed) {
      c.header("Retry-After", String(ipRate.resetSec));
      return c.json({ error: "rate_limited" }, 429);
    }
    const ctx = await getShopContext(shopDomain, {
      db: deps.db,
      engine: deps.defaultEngine,
      redis: deps.redis,
    });
    if (!ctx) return c.json({ error: "unknown_shop" }, 404);
    if (!trusted && !safeEqual(c.req.query("key") ?? "", ctx.shop.publicKey))
      return c.json({ error: "invalid_key" }, 401);

    const kind = trusted
      ? "storefront"
      : originKind(origin, [ctx.shop.domain, ...ctx.shop.storefrontDomains]);
    // Beacon analytics từ sandbox web pixel có origin khác → không tính là headless.
    const isEvents = c.req.method === "POST" && new URL(c.req.url).pathname === "/v1/events";
    if (kind !== "storefront" && !isEvents) {
      const decision = headlessDecision(ctx.shop.plan, ctx.features, origin);
      if (decision !== "ok")
        return c.json({ error: `headless_${decision}`, message: HEADLESS_ERRORS[decision] }, 403);
    }
    const shopRate = await limiter.hit(`shop:${ctx.shop.id}`, planById(ctx.shop.plan).rpm);
    if (!shopRate.allowed) {
      c.header("Retry-After", String(shopRate.resetSec));
      return c.json({ error: "rate_limited" }, 429);
    }
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    c.header("Cache-Tag", `shop-${ctx.shop.domain}`);
    c.header("Surrogate-Key", `shop-${ctx.shop.domain}`);
    c.set("ctx", ctx);
    c.set("engine", deps.engineFor(ctx));
    c.set("locale", (c.req.query("locale") ?? ctx.shop.primaryLocale).slice(0, 10));
    c.set("country", c.req.query("country")?.toUpperCase().slice(0, 2) ?? null);
    await next();
  });

  /** Micro-cache theo URL (đã chuẩn hoá thứ tự tham số). */
  const cached = async (c: Context<{ Variables: Vars }>, compute: () => Promise<unknown>) => {
    const url = new URL(c.req.url);
    url.searchParams.sort();
    const key = `${c.get("ctx").shop.domain}|${url.pathname}?${url.searchParams}`;
    const hit = cache.get(key);
    c.header("Cache-Control", CACHE_HEADER);
    if (hit) {
      c.header("X-Cache", "HIT");
      return c.json(hit.body as object, hit.status as 200);
    }
    const body = await compute();
    cache.set(key, { body, status: 200 });
    c.header("X-Cache", "MISS");
    return c.json(body as object);
  };

  const readFilters = (c: Context<{ Variables: Vars }>, collectionId?: string): AppliedFilters => {
    const json = parseJsonFilters(c.req.query("filters"));
    if (json) return json;
    return parseFilterParams(
      new URL(c.req.url).searchParams,
      filtersForScope(c.get("ctx"), collectionId),
    );
  };

  const commonRequest = (c: Context<{ Variables: Vars }>) => ({
    q: c.req.query("q"),
    page: Number(c.req.query("page") ?? 1) || 1,
    perPage: Number(c.req.query("per_page") ?? 24) || 24,
    sort: c.req.query("sort") ?? c.req.query("sort_by"),
    locale: c.get("locale"),
    country: c.get("country"),
    fields: c.req
      .query("fields")
      ?.split(",")
      .map((f) => f.trim())
      .filter(Boolean),
  });

  app.get("/v1/config", (c) =>
    cached(c, async () => buildPublicConfig(c.get("ctx"), c.get("locale"))),
  );

  app.get("/v1/suggest", (c) =>
    cached(c, () =>
      executeSuggest(
        c.get("ctx"),
        {
          q: c.req.query("q"),
          locale: c.get("locale"),
          limit: Number(c.req.query("limit") ?? 6),
          country: c.get("country"),
        },
        { engine: c.get("engine"), redis: deps.redis },
      ),
    ),
  );

  app.get("/v1/search", (c) =>
    cached(c, async () => {
      const ctx = c.get("ctx");
      const req = { ...commonRequest(c), filters: readFilters(c) };
      const body = await executeSearch(ctx, req, c.get("engine"));
      if (deps.redis && body.query && req.page === 1 && !body.redirect) {
        void recordEvents(deps.redis, ctx.shop.id, [
          { type: "search", query: body.query, results: body.total },
        ]).catch(() => undefined);
      }
      return body;
    }),
  );

  app.get("/v1/collection", async (c) => {
    const ctx = c.get("ctx");
    const ref = (c.req.query("collection") ?? "").slice(0, 255);
    if (!ref) return c.json({ error: "collection required" }, 400);
    const ckey = `${ctx.shop.domain}|${ref}`;
    let col = collectionCache.get(ckey);
    if (col === undefined) {
      col = await resolveCollection(c.get("engine"), ctx, ref);
      collectionCache.set(ckey, col);
    }
    if (!col) return c.json({ error: "unknown_collection" }, 404);
    const resolved = col;
    return cached(c, () =>
      executeSearch(
        ctx,
        { ...commonRequest(c), filters: readFilters(c, resolved.id), collection: resolved },
        c.get("engine"),
      ).then((b) => ({
        ...b,
        collection: { id: resolved.id, handle: resolved.handle },
      })),
    );
  });

  app.post("/v1/events", async (c) => {
    // sendBeacon gửi text/plain → tự parse.
    const raw = await c.req.text();
    let events: AnalyticsEvent[] = [];
    try {
      const body = JSON.parse(raw) as { events?: AnalyticsEvent[] };
      events = (body.events ?? [])
        .slice(0, 50)
        .filter((e) => e && typeof e === "object" && "type" in e);
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (deps.redis)
      await recordEvents(deps.redis, c.get("ctx").shop.id, events).catch(() => undefined);
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  });

  return app;
}

/** handle hoặc id số → collection (index nội dung c_{shop}). */
export async function resolveCollection(
  engine: SearchEngine,
  ctx: ShopSearchContext,
  ref: string,
): Promise<{ id: string; handle: string; sortOrder: string | null } | null> {
  if (/^\d+$/.test(ref)) {
    const d = await engine.getDocument<ContentDoc & { sort_order?: string }>(
      ctx.contentIndex,
      `collection-${ref}`,
    );
    return d ? { id: ref, handle: d.handle, sortOrder: d.sort_order ?? null } : null;
  }
  const r = await engine.search<ContentDoc & { sort_order?: string }>(ctx.contentIndex, {
    q: "*",
    queryBy: ["title"],
    filterBy: `type:=collection && handle:=\`${ref.replace(/`/g, "")}\``,
    perPage: 1,
  });
  const d = r.hits[0]?.document;
  return d
    ? { id: d.id.replace(/^collection-/, ""), handle: d.handle, sortOrder: d.sort_order ?? null }
    : null;
}
