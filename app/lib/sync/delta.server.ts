import type { Redis } from "ioredis";
import type { SearchEngine } from "../search/engine";
import type { MetafieldSpec } from "../search/index-schema";
import type { Db } from "../shop/shop.server";
import type { GraphqlExecutor } from "../shopify/graphql";
import type { BulkRunner } from "./bulk-runner";
import { importInBatches, assembleDocs, nestedSpec } from "./pipeline";
import { gidToId, isIndexable } from "./mapper";
import { DELTA_PRODUCTS_QUERY, PRODUCT_FILTER, COST } from "./queries";
import { MemoryStaging } from "./staging";
import {
  deleteProducts,
  refreshProducts,
  shopMetafields,
  withCarryOver,
  writeTargets,
} from "./incremental.server";

// Delta sync (task 1.9, mục 5.3) và đường "đột biến" của incremental (mục 5.2):
// - Poll products(updated_at > watermark − 2 phút) phân trang; > 2.000 kết quả → delta bulk (không tốn rate limit).
// - Delta bulk: một bulk lồng có filter updated_at; product còn lại trong danh sách chờ mà bulk không trả
//   (đã unpublish/xoá) → kiểm tra tồn tại rồi xoá.

export type DeltaDeps = {
  db: Db;
  engine: SearchEngine;
  ex: GraphqlExecutor;
  runner: BulkRunner;
  redis?: Redis;
};

export const DELTA_PAGE_LIMIT = 8; // 8 × 250 = 2.000 → quá ngưỡng thì chuyển sang bulk

export function sinceFilter(since: Date): string {
  return `updated_at:>'${since.toISOString().replace(/\.\d{3}Z$/, "Z")}'`;
}

type DeltaPage = {
  products: {
    nodes: { id: string; updatedAt: string; status: string; onlineStoreUrl: string | null }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

/** Liệt kê product đổi từ `since` (gồm cả product đã draft/unpublish để xoá khỏi index). */
export async function listChangedSince(
  ex: GraphqlExecutor,
  since: Date,
  maxPages = DELTA_PAGE_LIMIT,
) {
  const changed: { id: string; updatedAt: string; indexable: boolean }[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const d: DeltaPage = await ex.query<DeltaPage>(
      DELTA_PRODUCTS_QUERY,
      { cursor, query: sinceFilter(since) },
      {
        estimatedCost: COST.delta,
      },
    );
    for (const n of d.products.nodes)
      changed.push({ id: gidToId(n.id), updatedAt: n.updatedAt, indexable: isIndexable(n) });
    if (!d.products.pageInfo.hasNextPage) return { changed, overflow: false };
    cursor = d.products.pageInfo.endCursor;
  }
  return { changed, overflow: true };
}

/** Delta bulk: lấy mọi product đổi từ `since` qua bulk, upsert; trả về ID đã thấy. */
export async function runDeltaBulk(
  shopId: string,
  since: Date,
  deps: DeltaDeps,
  metafields?: MetafieldSpec[],
) {
  const shop = await deps.db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const mfs = metafields ?? (await shopMetafields(deps.db, deps.ex, shopId));
  const staging = new MemoryStaging();
  const spec = nestedSpec(staging, mfs);
  spec.query = spec.query.replace(
    JSON.stringify(PRODUCT_FILTER),
    JSON.stringify(`${PRODUCT_FILTER} AND ${sinceFilter(since)}`),
  );
  await deps.runner.run([spec]);
  const docs = [];
  for await (const d of assembleDocs(staging, { currency: shop.currency, metafields: mfs }))
    docs.push(d);
  const targets = await writeTargets(shopId, deps);
  const merged = await withCarryOver(deps.engine, targets[0], docs);
  for (const t of targets) await importInBatches(deps.engine, t, merged);
  await staging.clear();
  return new Set(docs.map((d) => d.id));
}

export type DeltaResult = {
  mode: "none" | "paged" | "bulk";
  upserted: number;
  deleted: number;
  watermark: Date;
};

/** Chạy delta theo watermark của shop (mục 5.3, mỗi 5 phút). */
export async function runDelta(
  shopId: string,
  deps: DeltaDeps,
  now = new Date(),
): Promise<DeltaResult> {
  const shop = await deps.db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const watermark =
    shop.lastSyncedUpdatedAt ?? shop.lastFullSyncAt ?? new Date(now.getTime() - 24 * 3600_000);
  const since = new Date(watermark.getTime() - 2 * 60_000);
  const { changed, overflow } = await listChangedSince(deps.ex, since);
  let result: DeltaResult;
  if (overflow) {
    const seen = await runDeltaBulk(shopId, since, deps);
    // Bulk chỉ trả product còn indexable → product đổi nhưng không có trong bulk = đã gỡ.
    const gone = changed.filter((c) => !c.indexable || !seen.has(c.id)).map((c) => c.id);
    const deleted = gone.length ? await deleteProducts(shopId, gone, deps) : 0;
    result = { mode: "bulk", upserted: seen.size, deleted, watermark: now };
  } else if (changed.length) {
    const r = await refreshProducts(
      shopId,
      changed.map((c) => c.id),
      deps,
    );
    result = { mode: "paged", upserted: r.upserted, deleted: r.deleted, watermark: now };
  } else {
    result = { mode: "none", upserted: 0, deleted: 0, watermark: now };
  }
  // Watermark = thời điểm bắt đầu lượt này (an toàn với thay đổi đến trong lúc chạy; lượt sau lùi thêm 2 phút).
  await deps.db.shop.update({ where: { id: shopId }, data: { lastSyncedUpdatedAt: now } });
  return result;
}
