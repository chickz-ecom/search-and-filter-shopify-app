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
import { syncCollection } from "../app/lib/sync/collections.server";
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
    default:
      return { skipped: `unhandled:${data.type}` };
  }
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

export async function handleMaintJob(job: Job<MaintJobData>): Promise<unknown> {
  return { skipped: `unhandled:${job.data.type}` };
}
