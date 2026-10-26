import type { Job } from "bullmq";
import {
  enqueueIncremental,
  getSyncQueue,
  INCREMENTAL_DEBOUNCE_MS,
  scheduledKey,
  type MaintJobData,
  type SyncJobData,
} from "../app/lib/queue/queue.server";
import { acquireLock, redis, rkey } from "../app/lib/redis.server";
import { getEngine } from "../app/lib/search";
import { cleanup, redactShop, uninstallShop } from "../app/lib/shop/lifecycle.server";
import { runChecksum } from "../app/lib/sync/checksum.server";
import { syncCollection } from "../app/lib/sync/collections.server";
import { runDelta } from "../app/lib/sync/delta.server";
import { runFullSync } from "../app/lib/sync/full-sync.server";
import { runIncrementalJob } from "../app/lib/sync/incremental-job.server";
import { deleteProducts, inventoryItemsToProducts } from "../app/lib/sync/incremental.server";
import { prisma, workerDeps } from "./context";

async function shopDomain(shopId: string): Promise<string | null> {
  const s = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { domain: true, uninstalledAt: true },
  });
  return s && !s.uninstalledAt ? s.domain : null;
}

export async function handleSyncJob(job: Job<SyncJobData>): Promise<unknown> {
  const data = job.data;
  switch (data.type) {
    case "full": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      // Một full sync mỗi shop tại một thời điểm.
      const release = await acquireLock(redis(), rkey("lock", "full", data.shopId), 6 * 3600_000);
      if (!release) return { skipped: "already-running" };
      try {
        return await runFullSync(data.shopId, workerDeps(domain), {
          reason: data.reason,
          syncJobId: data.syncJobId,
        });
      } finally {
        await release();
      }
    }
    case "incremental": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      return runIncrementalJob(data.shopId, {
        ...workerDeps(domain),
        schedule: scheduleIncremental,
      });
    }
    case "delete": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      return { deleted: await deleteProducts(data.shopId, data.productIds, workerDeps(domain)) };
    }
    case "inventory": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      const productIds = await inventoryItemsToProducts(
        workerDeps(domain).ex,
        data.inventoryItemIds,
      );
      await enqueueIncremental(data.shopId, productIds);
      return { productIds };
    }
    case "collection": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      // Thay đổi cùng collection được tuần tự hoá để vị trí không bị ghi đè lẫn nhau.
      const release = await acquireLock(
        redis(),
        rkey("lock", "col", data.shopId, data.collectionId),
        10 * 60_000,
      );
      if (!release) {
        await getSyncQueue().add("collection", data, { delay: 5_000 });
        return { rescheduled: true };
      }
      try {
        return await syncCollection(data.shopId, data, workerDeps(domain));
      } finally {
        await release();
      }
    }
    case "delta": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      const release = await acquireLock(redis(), rkey("lock", "delta", data.shopId), 15 * 60_000);
      if (!release) return { skipped: "already-running" };
      try {
        return await runDelta(data.shopId, workerDeps(domain));
      } finally {
        await release();
      }
    }
    case "checksum": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      const release = await acquireLock(
        redis(),
        rkey("lock", "checksum", data.shopId),
        2 * 3600_000,
      );
      if (!release) return { skipped: "already-running" };
      try {
        return await runChecksum(data.shopId, workerDeps(domain), {
          enqueueFullSync: queueFullSync,
        });
      } finally {
        await release();
      }
    }
    case "uninstall":
      return uninstallShop(data.shopId, { db: prisma, redis: redis() });
    case "redact":
      return redactShop(data.shopDomain, { db: prisma, engine: getEngine(), redis: redis() });
    default:
      return { skipped: `unhandled:${data.type}` };
  }
}

async function queueFullSync(shopId: string, reason: string) {
  await prisma.shop.update({ where: { id: shopId }, data: { syncState: "QUEUED" } });
  await getSyncQueue().add(
    "full",
    { type: "full", shopId, reason },
    { jobId: `full-${shopId}-${Date.now()}` },
  );
}

/** Shop đang hoạt động, đã có full sync, không đang full sync. */
async function activeShops(select: { lastSyncedUpdatedAt?: true } = {}) {
  return prisma.shop.findMany({
    where: {
      uninstalledAt: null,
      lastFullSyncAt: { not: null },
      syncState: { notIn: ["RUNNING", "QUEUED"] },
    },
    select: { id: true, ...select },
  });
}

/** Lượt incremental tiếp theo (còn ID chờ hoặc lượt trước đang giữ khoá). */
async function scheduleIncremental(shopId: string, delayMs: number) {
  const ok = await redis().set(scheduledKey(shopId), "1", "PX", INCREMENTAL_DEBOUNCE_MS * 10, "NX");
  if (ok) {
    await getSyncQueue().add(
      "incremental",
      { type: "incremental", shopId },
      { delay: delayMs, jobId: `inc-${shopId}-${Date.now()}` },
    );
  }
}

export const DELTA_INTERVAL_MS = 5 * 60_000;

export async function handleMaintJob(job: Job<MaintJobData>): Promise<unknown> {
  const q = getSyncQueue();
  switch (job.data.type) {
    case "tick-delta": {
      // Mỗi phút: shop nào đến hạn (watermark cũ hơn 5 phút) thì xếp delta; jobId theo khung 5 phút để không trùng.
      const now = Date.now();
      const due = (await activeShops({ lastSyncedUpdatedAt: true })).filter(
        (s) => !s.lastSyncedUpdatedAt || now - s.lastSyncedUpdatedAt.getTime() >= DELTA_INTERVAL_MS,
      );
      const bucket = Math.floor(now / DELTA_INTERVAL_MS);
      await q.addBulk(
        due.map((s) => ({
          name: "delta",
          data: { type: "delta" as const, shopId: s.id },
          opts: { jobId: `delta-${s.id}-${bucket}` },
        })),
      );
      return { enqueued: due.length };
    }
    case "tick-nightly": {
      const shops = await activeShops();
      const day = new Date().toISOString().slice(0, 10);
      await q.addBulk(
        shops.flatMap((s) => [
          {
            name: "checksum",
            data: { type: "checksum" as const, shopId: s.id },
            opts: { jobId: `checksum-${s.id}-${day}` },
          },
          {
            name: "best-selling",
            data: { type: "best-selling" as const, shopId: s.id },
            opts: { jobId: `bs-${s.id}-${day}` },
          },
          {
            name: "shop-refresh",
            data: {
              type: "shop-refresh" as const,
              shopId: s.id,
              what: ["markets", "locales"] as ("markets" | "locales")[],
            },
            opts: { jobId: `refresh-${s.id}-${day}` },
          },
        ]),
      );
      return { shops: shops.length };
    }
    case "tick-cleanup":
      return cleanup({ db: prisma, engine: getEngine(), redis: redis() });
    default:
      return { skipped: `unhandled:${job.data.type}` };
  }
}
