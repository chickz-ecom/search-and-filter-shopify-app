import type { Prisma } from "@prisma/client";
import type { Redis } from "ioredis";
import type { SearchEngine } from "../search/engine";
import { buildContentSchema, buildProductSchema, type MetafieldSpec } from "../search/index-schema";
import {
  contentAlias,
  contentCollection,
  curationSetName,
  nextVersion,
  productAlias,
  productCollection,
  scopedKeyCollections,
  synonymSetName,
} from "../search/names";
import type { ContentDoc } from "../search/product-doc";
import { pushMerchToEngine } from "../merch/engine-sync.server";
import {
  fixedPriceCountries,
  loadShopConfig,
  requiredMetafields,
  shopFeatures,
  type Db,
} from "../shop/shop.server";
import { semanticAllowed } from "../billing/plans";
import { env } from "../env.server";
import { rkey } from "../redis.server";
import { realClock, type Clock, type GraphqlExecutor } from "../shopify/graphql";
import { currentRanks } from "./best-selling.server";
import { BulkRunner, catalogStats, planShards } from "./bulk-runner";
import { mapProduct, type ProductNode } from "./mapper";
import { fetchProductMetafieldDefinitions, resolveMetafieldSpecs } from "./metafields.server";
import {
  assembleDocs,
  buildFullSyncSpecs,
  computePosCap,
  importInBatches,
  type CollectionInfo,
} from "./pipeline";
import { earlyProductsQuery, PRODUCT_FILTER } from "./queries";
import { MemoryStaging, MEMORY_STAGING_MAX_PRODUCTS, PgStaging, type Staging } from "./staging";

// Full sync (task 1.5, mục 5.1): collection version mới → (lượt sớm) → bulk song song → join → import
// → kiểm tra số lượng → swap alias (không downtime). Chỉ chạy khi cài, schema đổi, hoặc lệch lớn.

export type FullSyncDeps = {
  db: Db;
  engine: SearchEngine;
  ex: GraphqlExecutor;
  runner: BulkRunner;
  redis?: Redis;
  clock?: Clock;
  /** Bật lượt "có kết quả sớm" khi shop chưa có index (mặc định true). */
  earlyResults?: boolean;
  /** Giới hạn lượt sớm. */
  earlyMaxProducts?: number;
  earlyMaxMs?: number;
  /** Cho test: ép kiểu staging. */
  staging?: "memory" | "pg";
  /** Model embedding (mặc định env TYPESENSE_EMBED_MODEL). */
  embedModel?: string;
};

export type FullSyncResult = {
  status: "SUCCEEDED" | "FAILED";
  collection: string;
  expected: number;
  staged: number;
  imported: number;
  early: number;
  swapped: boolean;
  durationMs: number;
  error?: string;
};

/** Key Redis đánh dấu full sync đang chạy → incremental ghi vào cả collection mới (mục 5.1 bước 8). */
export const fullSyncTargetKey = (shopId: string) => rkey("fullsync", shopId);

/** Lệch tối đa giữa số product Shopify báo và số đã index (mục 5.1 bước 7). */
export const MAX_COUNT_DRIFT = 0.02;

export function countsAcceptable(expected: number, indexed: number): boolean {
  if (expected === 0) return indexed === 0 || indexed < 5;
  return Math.abs(indexed - expected) / expected <= MAX_COUNT_DRIFT;
}

async function updateProgress(db: Db, shopId: string, data: Prisma.ShopUpdateInput) {
  await db.shop.update({ where: { id: shopId }, data }).catch(() => undefined);
}

export async function runFullSync(
  shopId: string,
  deps: FullSyncDeps,
  opts: { reason: string; syncJobId?: string } = { reason: "manual" },
): Promise<FullSyncResult> {
  const { db, engine, ex, runner } = deps;
  const clock = deps.clock ?? realClock;
  const t0 = clock.now();
  const startedAt = new Date(t0);
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const job = opts.syncJobId
    ? await db.syncJob.update({
        where: { id: opts.syncJobId },
        data: { status: "RUNNING", startedAt },
      })
    : await db.syncJob.create({
        data: {
          shopId,
          type: "FULL",
          status: "RUNNING",
          startedAt,
          stats: { reason: opts.reason },
        },
      });
  await updateProgress(db, shopId, { syncState: "RUNNING", indexedCount: 0 });

  const alias = productAlias(shopId);
  const current = await engine.getAlias(alias);
  const version = nextVersion(current);
  const name = productCollection(shopId, version);
  const firstSync = !current;
  let staging: Staging | undefined;
  let early = 0;
  const stats: Record<string, unknown> = { reason: opts.reason, collection: name, firstSync };

  const finish = async (result: Omit<FullSyncResult, "durationMs">): Promise<FullSyncResult> => {
    const durationMs = clock.now() - t0;
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: result.status,
        finishedAt: new Date(clock.now()),
        error: result.error ?? null,
        stats: { ...stats, ...result, durationMs } as Prisma.InputJsonValue,
      },
    });
    await deps.redis?.del(fullSyncTargetKey(shopId));
    await staging?.clear().catch(() => undefined);
    return { ...result, durationMs };
  };

  try {
    const config = await loadShopConfig(db, shopId);
    const refs = requiredMetafields(config);
    const metafields: MetafieldSpec[] = refs.length
      ? resolveMetafieldSpecs(refs, await fetchProductMetafieldDefinitions(ex))
      : [];
    const secondaryLocales = shop.locales.filter((l) => l !== shop.primaryLocale);

    // Scoped search key của shop (D6/6.1): search-api chỉ đọc được collection của shop này.
    if (!shop.searchKeyScoped && "createSearchOnlyKey" in engine) {
      const value = await (
        engine as unknown as { createSearchOnlyKey(c: string[], d: string): Promise<string> }
      )
        .createSearchOnlyKey(scopedKeyCollections(shopId), `search ${shop.domain}`)
        .catch(() => null);
      if (value) await updateProgress(db, shopId, { searchKeyScoped: value });
    }
    // Synonym/curation set phải tồn tại trước khi collection tham chiếu tới.
    await pushMerchToEngine(db, engine, shopId);
    await engine.createCollection(
      buildProductSchema({
        name,
        metafields,
        locales: secondaryLocales,
        synonymSets: [synonymSetName(shopId)],
        curationSets: [curationSetName(shopId)],
        // AI search (5.1): chỉ khi merchant bật và gói cho phép — vector tốn CPU engine lúc import.
        semantic:
          config.settings.semanticSearch && semanticAllowed(shop.plan, shopFeatures(shop))
            ? { model: deps.embedModel ?? env().TYPESENSE_EMBED_MODEL }
            : undefined,
      }),
    );
    // Lần đầu: trỏ alias ngay để lượt sớm phục vụ search luôn. Re-index: ghi đôi qua marker.
    if (firstSync) await engine.upsertAlias(alias, name);
    else await deps.redis?.set(fullSyncTargetKey(shopId), name, "EX", 6 * 3600);

    const catalog = await catalogStats(ex, PRODUCT_FILTER);
    stats.expected = catalog.count;
    await updateProgress(db, shopId, { productCount: catalog.count });

    // Bulk bắt đầu trước, lượt sớm chạy song song trong lúc chờ (mục 5.1 bước 5).
    const useMemory = deps.staging
      ? deps.staging === "memory"
      : catalog.count <= MEMORY_STAGING_MAX_PRODUCTS;
    staging = useMemory ? new MemoryStaging() : new PgStaging(db, job.id);
    const collections: CollectionInfo[] = [];
    const manualSizes = new Map<string, number>();
    const shards = planShards(catalog.count, catalog.oldest, catalog.newest);
    const priceCountries = fixedPriceCountries(shop);
    stats.priceCountries = priceCountries;
    const bulkPromise = runner.run(
      buildFullSyncSpecs({
        staging,
        metafields,
        shards,
        priceCountries,
        manualSizes,
        locales: secondaryLocales,

        onCollection: (c) => collections.push(c),
      }),
    );
    const earlyPromise =
      firstSync && deps.earlyResults !== false
        ? runEarlyPass(shopId, name, deps, metafields, shop.currency).catch(() => 0)
        : Promise.resolve(0);
    const [bulkResults, earlyCount] = await Promise.all([bulkPromise, earlyPromise]);
    early = earlyCount;
    stats.bulks = bulkResults.map((r) => ({
      name: r.name,
      rows: r.rows,
      waitMs: r.waitMs,
      processMs: r.processMs,
    }));

    const staged = await staging.count();
    const posCap = computePosCap([...manualSizes.values()]);
    stats.manualPositions = [...manualSizes.values()].reduce((a, b) => a + b, 0);
    stats.posCap = posCap ?? null;
    const features = {
      ...((shop.features as Record<string, unknown>) ?? {}),
      posCap: posCap ?? null,
    };
    await updateProgress(db, shopId, { features: features as Prisma.InputJsonValue });
    // Re-index: giữ best_selling_rank đang có (lượt đêm cập nhật lại sau).
    const bestSelling = current
      ? await currentRanks(engine, current).catch(() => new Map<string, number>())
      : undefined;
    let lastProgress = 0;
    const imported = await importInBatches(
      engine,
      name,
      assembleDocs(staging, {
        currency: shop.currency,
        metafields,
        bestSelling,
        posCap,
        priceCountries,
        locales: secondaryLocales,
      }),
      {
        onProgress: (n) => {
          if (clock.now() - lastProgress > 2000) {
            lastProgress = clock.now();
            void updateProgress(db, shopId, { indexedCount: n });
          }
        },
      },
    );
    stats.importErrors = imported.errors.slice(0, 5);

    const indexed = (await engine.getCollection(name))?.numDocuments ?? 0;
    const ok =
      countsAcceptable(catalog.count, imported.imported) &&
      imported.failed <= Math.max(5, staged * 0.001);

    await buildContentIndex(shopId, version, collections, engine);

    if (!ok) {
      if (!firstSync) await engine.dropCollection(name);
      await updateProgress(db, shopId, { syncState: "ERROR" });
      return finish({
        status: "FAILED",
        collection: name,
        expected: catalog.count,
        staged,
        imported: imported.imported,
        early,
        swapped: false,
        error: `Count check failed: expected ${catalog.count}, imported ${imported.imported}, failed ${imported.failed}`,
      });
    }

    if (!firstSync) {
      await engine.upsertAlias(alias, name);
      if (current && current !== name) await engine.dropCollection(current);
    }
    await updateProgress(db, shopId, {
      syncState: "IDLE",
      indexVersion: version,
      lastFullSyncAt: new Date(clock.now()),
      // Watermark lùi 2 phút để delta không bỏ sót thay đổi trong lúc bulk chạy (mục 5.3).
      lastSyncedUpdatedAt: new Date(t0 - 2 * 60 * 1000),
      productCount: catalog.count,
      indexedCount: indexed,
    });
    return finish({
      status: "SUCCEEDED",
      collection: name,
      expected: catalog.count,
      staged,
      imported: imported.imported,
      early,
      swapped: !firstSync,
    });
  } catch (err) {
    if (!firstSync) await engine.dropCollection(name).catch(() => undefined);
    await updateProgress(db, shopId, { syncState: "ERROR" });
    return finish({
      status: "FAILED",
      collection: name,
      expected: Number(stats.expected ?? 0),
      staged: (await staging?.count().catch(() => 0)) ?? 0,
      imported: 0,
      early,
      swapped: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Lượt "có kết quả sớm": vài trang product mới nhất, giá cấp product, ghi thẳng vào collection mới. */
export async function runEarlyPass(
  shopId: string,
  collection: string,
  deps: Pick<FullSyncDeps, "ex" | "engine" | "db" | "clock" | "earlyMaxProducts" | "earlyMaxMs">,
  metafields: MetafieldSpec[],
  currency: string,
): Promise<number> {
  const clock = deps.clock ?? realClock;
  const started = clock.now();
  const max = deps.earlyMaxProducts ?? 1000;
  const maxMs = deps.earlyMaxMs ?? 45_000;
  const query = earlyProductsQuery(metafields);
  let cursor: string | null = null;
  let total = 0;
  while (total < max && clock.now() - started < maxMs) {
    const first = Math.min(50, max - total);
    type Page = {
      products: {
        nodes: ProductNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    const d: Page = await deps.ex.query<Page>(
      query,
      { first, cursor, query: PRODUCT_FILTER },
      { estimatedCost: 2 + first * (15 + metafields.length) },
    );
    const docs = d.products.nodes.map((p) => mapProduct(p, [], { currency, metafields }));
    if (docs.length) {
      await deps.engine.importDocuments(collection, docs, "upsert");
      total += docs.length;
      await updateProgress(deps.db, shopId, { indexedCount: total });
    }
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  return total;
}

/** Index c_{shopId}: collection (pages/articles khi có scope — task 2.x). Swap alias như product. */
export async function buildContentIndex(
  shopId: string,
  version: number,
  collections: CollectionInfo[],
  engine: SearchEngine,
): Promise<void> {
  const alias = contentAlias(shopId);
  const name = contentCollection(shopId, version);
  const old = await engine.getAlias(alias);
  if (old === name) return;
  await engine.createCollection(buildContentSchema(name));
  const docs: (ContentDoc & { sort_order: string })[] = collections.map((c) => ({
    id: `collection-${c.id}`,
    type: "collection",
    sort_order: c.sortOrder,
    title: c.title,
    handle: c.handle,
    url: `/collections/${c.handle}`,
    body_text: "",
    updated_at: c.updatedAt ? Math.floor(Date.parse(c.updatedAt) / 1000) : 0,
  }));
  if (docs.length) await engine.importDocuments(name, docs, "upsert");
  await engine.upsertAlias(alias, name);
  if (old) await engine.dropCollection(old);
}
