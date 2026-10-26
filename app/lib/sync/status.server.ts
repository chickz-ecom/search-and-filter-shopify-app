import type { Db } from "../shop/shop.server";

// Trạng thái sync cho merchant (mục 5.5): lần sync cuối, đã index / tổng, job đang chạy, lỗi + cách sửa.

export type SyncStatus = {
  state: "IDLE" | "QUEUED" | "RUNNING" | "ERROR";
  productCount: number;
  indexedCount: number;
  percent: number;
  lastFullSyncAt: string | null;
  lastIncrementalAt: string | null;
  running: { id: string; type: string; startedAt: string } | null;
  lastError: { message: string; at: string } | null;
};

export async function getSyncStatus(db: Db, shopId: string): Promise<SyncStatus> {
  const [shop, running, failed] = await Promise.all([
    db.shop.findUniqueOrThrow({ where: { id: shopId } }),
    db.syncJob.findFirst({ where: { shopId, status: "RUNNING" }, orderBy: { startedAt: "desc" } }),
    db.syncJob.findFirst({ where: { shopId, status: "FAILED" }, orderBy: { startedAt: "desc" } }),
  ]);
  const total = shop.productCount;
  const indexed = Math.min(shop.indexedCount, total || shop.indexedCount);
  return {
    state: shop.syncState,
    productCount: total,
    indexedCount: indexed,
    percent: total
      ? Math.min(100, Math.round((indexed / total) * 100))
      : shop.syncState === "IDLE"
        ? 100
        : 0,
    lastFullSyncAt: shop.lastFullSyncAt?.toISOString() ?? null,
    lastIncrementalAt: shop.lastIncrementalAt?.toISOString() ?? null,
    running: running
      ? { id: running.id, type: running.type, startedAt: running.startedAt.toISOString() }
      : null,
    lastError:
      shop.syncState === "ERROR" && failed?.error
        ? { message: failed.error, at: (failed.finishedAt ?? failed.startedAt).toISOString() }
        : null,
  };
}
