import type { Job } from "bullmq";
import {
  enqueueIncremental,
  getMaintQueue,
  getSyncQueue,
  INCREMENTAL_DEBOUNCE_MS,
  scheduledKey,
  type MaintJobData,
  type SyncJobData,
} from "../app/lib/queue/queue.server";
import { refreshAllPlans } from "../app/lib/billing/subscription.server";
import { env } from "../app/lib/env.server";
import { snapshotEngine } from "../app/lib/search/backup.server";
import { acquireLock, redis, rkey } from "../app/lib/redis.server";
import { getEngine } from "../app/lib/search";
import { cleanup, redactShop, uninstallShop } from "../app/lib/shop/lifecycle.server";
import { refreshShop } from "../app/lib/shop/markets.server";
import { rollupAnalytics } from "../app/lib/search-service/rollup.server";
import {
  applyBestSellingRanks,
  fetchBestSellingOrder,
  storefrontContextTransport,
} from "../app/lib/sync/best-selling.server";
import { runChecksum } from "../app/lib/sync/checksum.server";
import { refreshStoreContent } from "../app/lib/sync/content.server";
import { orderToLines, type RankMetric } from "../app/lib/sync/order-ranking";
import {
  fetchOrder,
  loadInitialOrders,
  refreshOrderRanks,
  replaceOrderLines,
} from "../app/lib/sync/order-ranking.server";
import { unauthenticated } from "../app/shopify.server";
import { syncCollection } from "../app/lib/sync/collections.server";
import { runDelta } from "../app/lib/sync/delta.server";
import { runFullSync } from "../app/lib/sync/full-sync.server";
import { runIncrementalJob } from "../app/lib/sync/incremental-job.server";
import { runReindex } from "../app/lib/sync/reindex.server";
import { deleteProducts, inventoryItemsToProducts } from "../app/lib/sync/incremental.server";
import { refreshPlans } from "../app/lib/billing/plans-registry.server";
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
  // AI search theo gói (full sync / reindex) đọc registry gói của back-office (8.1).
  await refreshPlans(prisma);
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
    case "reindex": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      // Chung khoá với full sync: hai việc cùng dựng index mới, không được chạy song song.
      const release = await acquireLock(redis(), rkey("lock", "full", data.shopId), 3600_000);
      if (!release) return { skipped: "already-running" };
      try {
        return await runReindex(data.shopId, workerDeps(domain), { reason: data.reason });
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
    case "content": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      const d = workerDeps(domain);
      return refreshStoreContent(d.db, d.engine, d.ex, data.shopId);
    }
    case "best-selling": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      // Nguồn "orders" (task 2.15): hạng tính từ OrderLine, không hỏi Storefront.
      const bs = await bestSellingSettings(data.shopId);
      if (bs.source === "orders")
        return refreshOrderRanks(prisma, getEngine(), data.shopId, bs.metric);
      const transport = async (q: string, v: Record<string, unknown>) => {
        const { storefront } = await unauthenticated.storefront(domain);
        return storefrontContextTransport(storefront)(q, v);
      };
      const order = await fetchBestSellingOrder(transport);
      return applyBestSellingRanks(getEngine(), data.shopId, order);
    }
    case "order": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      if ((await bestSellingSettings(data.shopId)).source !== "orders")
        return { skipped: "source" };
      const order = await fetchOrder(workerDeps(domain).ex, data.orderGid);
      const orderId = data.orderGid.split("/").pop()!;
      await replaceOrderLines(prisma, data.shopId, orderId, order ? orderToLines(order) : []);
      // Gộp hạng theo khung 15 phút: nhiều đơn trong khung → một lần tính, chạy cuối khung (DoD ≤ 15 phút).
      const bucket = Math.floor(Date.now() / ORDER_RANK_WINDOW_MS);
      await getSyncQueue().add(
        "order-ranks",
        { type: "order-ranks", shopId: data.shopId },
        {
          jobId: `order-ranks-${data.shopId}-${bucket}`,
          delay: (bucket + 1) * ORDER_RANK_WINDOW_MS - Date.now(),
        },
      );
      return { lines: order ? orderToLines(order).length : 0 };
    }
    case "orders-initial": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      const d = workerDeps(domain);
      const r = await loadInitialOrders(prisma, d.runner, data.shopId);
      const bs = await bestSellingSettings(data.shopId);
      return { ...r, ...(await refreshOrderRanks(prisma, getEngine(), data.shopId, bs.metric)) };
    }
    case "order-ranks": {
      const bs = await bestSellingSettings(data.shopId);
      if (bs.source !== "orders") return { skipped: "source" };
      return refreshOrderRanks(prisma, getEngine(), data.shopId, bs.metric);
    }
    case "shop-refresh": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      const r = await refreshShop(data.shopId, data.what, workerDeps(domain));
      if (r.needsFullSync) await queueFullSync(data.shopId, "shop-settings-changed");
      return r;
    }
    case "uninstall":
      return uninstallShop(data.shopId, { db: prisma, redis: redis() });
    case "redact":
      return redactShop(data.shopDomain, { db: prisma, engine: getEngine(), redis: redis() });
    default: {
      // Mọi loại job đã có handler; TypeScript báo lỗi nếu thêm loại mới mà quên xử lý.
      const unhandled: never = data;
      return { skipped: `unhandled:${(unhandled as { type: string }).type}` };
    }
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
export const ORDER_RANK_WINDOW_MS = 15 * 60_000;

async function bestSellingSettings(shopId: string) {
  const s = await prisma.searchSettings.findUnique({
    where: { shopId },
    select: { bestSellingSource: true, bestSellingMetric: true },
  });
  return {
    source: s?.bestSellingSource ?? "storefront",
    metric: (s?.bestSellingMetric ?? "quantity") as RankMetric,
  };
}

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
            name: "content",
            data: { type: "content" as const, shopId: s.id },
            opts: { jobId: `content-${s.id}-${day}` },
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
      await getMaintQueue().add(
        "refresh-plans",
        { type: "refresh-plans" },
        { jobId: `refresh-plans-${day}` },
      );
      return { shops: shops.length };
    }
    case "rollup-analytics":
      return rollupAnalytics(redis(), prisma);
    case "refresh-plans":
      return refreshAllPlans(prisma);
    case "typesense-snapshot":
      return snapshotEngine(getEngine(), env().TYPESENSE_SNAPSHOT_DIR);
    case "tick-cleanup":
      return cleanup({ db: prisma, engine: getEngine(), redis: redis() });
    default: {
      const unhandled: never = job.data;
      return { skipped: `unhandled:${(unhandled as { type: string }).type}` };
    }
  }
}
