import type { Redis } from "ioredis";
import type { SearchEngine } from "../search/engine";
import { productAlias } from "../search/names";
import type { Db } from "../shop/shop.server";
import type { GraphqlExecutor } from "../shopify/graphql";
import type { BulkRunner } from "./bulk-runner";
import { syncCollection } from "./collections.server";
import { MAX_COUNT_DRIFT } from "./full-sync.server";
import { deleteProducts, refreshProducts } from "./incremental.server";
import { gidToId } from "./mapper";
import { bulkChecksumQuery, bulkCollectionsQuery } from "./queries";

// Checksum đêm (task 1.9, mục 5.3): thay cho full re-index hằng đêm.
// 1) bulk products { id updatedAt } + bulk collections { products { id } } (không tốn rate limit)
// 2) so với id / updated_at / collections trong index
// 3) chỉ lấy lại ID lệch/thiếu, xoá ID thừa, đồng bộ lại collection có thành viên lệch. Lệch > 2% → full sync.

export type IndexRow = { id: string; updated_at: number; collections?: string[] };

export type ChecksumDiff = {
  missing: string[];
  stale: string[];
  extra: string[];
  /** Collection có thành viên lệch giữa Shopify và index. */
  collections: string[];
  shopifyCount: number;
  indexCount: number;
};

export function diffChecksum(
  shopify: Map<string, number>,
  index: Map<string, IndexRow>,
  shopifyMembership?: Map<string, Set<string>>,
  /** Collection đã publish (bulk chỉ trả các collection này) — collection khác bỏ qua khi so. */
  knownCollections?: Set<string>,
): ChecksumDiff {
  const missing: string[] = [];
  const stale: string[] = [];
  const extra: string[] = [];
  const collections = new Set<string>();
  for (const [id, updatedAt] of shopify) {
    const row = index.get(id);
    if (!row) missing.push(id);
    // Index lưu giây; Shopify trả ISO → so theo giây. Index mới hơn (do incremental) không phải lệch.
    else if (row.updated_at < updatedAt) stale.push(id);
  }
  for (const id of index.keys()) if (!shopify.has(id)) extra.push(id);
  if (shopifyMembership) {
    for (const [id, row] of index) {
      if (!shopify.has(id)) continue;
      const expected = shopifyMembership.get(id) ?? new Set<string>();
      const actual = new Set(
        (row.collections ?? []).filter((c) => !knownCollections || knownCollections.has(c)),
      );
      for (const c of expected) if (!actual.has(c)) collections.add(c);
      for (const c of actual) if (!expected.has(c)) collections.add(c);
    }
  }
  return {
    missing,
    stale,
    extra,
    collections: [...collections].sort(),
    shopifyCount: shopify.size,
    indexCount: index.size,
  };
}

export function driftRatio(d: ChecksumDiff): number {
  const base = Math.max(1, d.shopifyCount);
  return (d.missing.length + d.stale.length + d.extra.length) / base;
}

export type ChecksumDeps = {
  db: Db;
  engine: SearchEngine;
  ex: GraphqlExecutor;
  runner: BulkRunner;
  redis?: Redis;
};

export type ChecksumResult = {
  action: "none" | "repaired" | "full-sync";
  diff: Omit<ChecksumDiff, "missing" | "stale" | "extra"> & {
    missing: number;
    stale: number;
    extra: number;
  };
  durationMs: number;
  writes: number;
};

export async function runChecksum(
  shopId: string,
  deps: ChecksumDeps,
  opts: { enqueueFullSync: (shopId: string, reason: string) => Promise<void> },
): Promise<ChecksumResult> {
  const t0 = Date.now();
  const shopify = new Map<string, number>();
  const membership = new Map<string, Set<string>>();
  const published = new Set<string>();
  await deps.runner.run([
    {
      name: "checksum",
      query: bulkChecksumQuery(),
      onRow: ((r: { id: string; updatedAt: string }) => {
        shopify.set(gidToId(r.id), Math.floor(Date.parse(r.updatedAt) / 1000));
      }) as never,
    },
    {
      name: "collections",
      query: bulkCollectionsQuery(),
      groupObjects: true,
      onRow: ((r: { id: string; __parentId?: string }) => {
        if (!r.__parentId) {
          published.add(gidToId(r.id));
          return;
        }
        const pid = gidToId(r.id);
        const cid = gidToId(r.__parentId);
        const set = membership.get(pid) ?? new Set<string>();
        set.add(cid);
        membership.set(pid, set);
      }) as never,
    },
  ]);

  const index = new Map<string, IndexRow>();
  for await (const row of deps.engine.exportDocuments<IndexRow>(productAlias(shopId), [
    "id",
    "updated_at",
    "collections",
  ])) {
    index.set(row.id, row);
  }
  const diff = diffChecksum(shopify, index, membership, published);
  const summary = {
    ...diff,
    missing: diff.missing.length,
    stale: diff.stale.length,
    extra: diff.extra.length,
  };

  if (driftRatio(diff) > MAX_COUNT_DRIFT && diff.shopifyCount > 50) {
    await opts.enqueueFullSync(shopId, "checksum-drift");
    return { action: "full-sync", diff: summary, durationMs: Date.now() - t0, writes: 0 };
  }
  let writes = 0;
  const refresh = [...diff.missing, ...diff.stale];
  if (refresh.length) {
    const r = await refreshProducts(shopId, refresh, deps);
    writes += r.upserted + r.deleted;
  }
  if (diff.extra.length) writes += await deleteProducts(shopId, diff.extra, deps);
  for (const c of diff.collections) {
    const r = await syncCollection(shopId, { collectionId: c }, deps);
    writes += r.updated + r.removed;
  }
  return {
    action: writes ? "repaired" : "none",
    diff: summary,
    durationMs: Date.now() - t0,
    writes,
  };
}
