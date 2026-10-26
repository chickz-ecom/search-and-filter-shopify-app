import type { Redis } from "ioredis";
import { pendingKey, scheduledKey, SPIKE_THRESHOLD, takePending } from "../queue/queue.server";
import { acquireLock, rkey } from "../redis.server";
import { realClock, type Clock } from "../shopify/graphql";
import { runDeltaBulk, type DeltaDeps } from "./delta.server";
import { refreshProducts, shopMetafields } from "./incremental.server";

// Job incremental theo shop (mục 5.2): debounce đã làm ở enqueueIncremental; ở đây lấy ID chờ theo lô,
// xử lý trong ngân sách thời gian, còn dư thì lên lịch lượt sau. > 2.000 ID chờ → delta bulk.

export type IncrementalJobDeps = DeltaDeps & {
  redis: Redis;
  clock?: Clock;
  /** Lên lịch lượt tiếp theo (đặt cờ scheduled + thêm job trễ). */
  schedule: (shopId: string, delayMs: number) => Promise<void>;
};

export type IncrementalJobResult =
  | { mode: "locked" }
  | { mode: "batches"; processed: number; upserted: number; deleted: number; remaining: number }
  | { mode: "spike"; processed: number; viaBulk: number; refreshed: number };

export async function runIncrementalJob(
  shopId: string,
  deps: IncrementalJobDeps,
  opts: { batch?: number; budgetMs?: number } = {},
): Promise<IncrementalJobResult> {
  const clock = deps.clock ?? realClock;
  const release = await acquireLock(deps.redis, rkey("lock", "inc", shopId), 10 * 60_000);
  if (!release) {
    // Lượt khác của shop đang chạy: thử lại sau, ID vẫn nằm trong set chờ.
    await deps.schedule(shopId, 5_000);
    return { mode: "locked" };
  }
  try {
    const size = await deps.redis.scard(pendingKey(shopId));
    if (size > SPIKE_THRESHOLD) {
      await deps.redis.del(scheduledKey(shopId));
      const ids = ((await deps.redis.spop(pendingKey(shopId), size)) as string[] | null) ?? [];
      const shop = await deps.db.shop.findUniqueOrThrow({ where: { id: shopId } });
      const watermark =
        shop.lastSyncedUpdatedAt ?? shop.lastFullSyncAt ?? new Date(clock.now() - 3600_000);
      const since = new Date(Math.min(watermark.getTime(), clock.now() - 15 * 60_000) - 2 * 60_000);
      const metafields = await shopMetafields(deps.db, deps.ex, shopId);
      const seen = await runDeltaBulk(shopId, since, deps, metafields);
      // ID chờ mà bulk không trả về (đã gỡ / không publish) → lấy lại từng lô để xoá cho đúng.
      const missing = ids.filter((id) => !seen.has(id));
      const r = await refreshProducts(shopId, missing, deps, {
        currency: shop.currency,
        metafields,
      });
      return {
        mode: "spike",
        processed: ids.length,
        viaBulk: seen.size,
        refreshed: r.upserted + r.deleted,
      };
    }

    const batch = opts.batch ?? 250;
    const budget = opts.budgetMs ?? 60_000;
    const started = clock.now();
    let processed = 0;
    let upserted = 0;
    let deleted = 0;
    let remaining = 0;
    let ctx:
      { currency: string; metafields: Awaited<ReturnType<typeof shopMetafields>> } | undefined;
    do {
      const take = await takePending(deps.redis, shopId, batch);
      remaining = take.remaining;
      if (!take.ids.length) break;
      if (!ctx) {
        const shop = await deps.db.shop.findUniqueOrThrow({ where: { id: shopId } });
        ctx = {
          currency: shop.currency,
          metafields: await shopMetafields(deps.db, deps.ex, shopId),
        };
      }
      try {
        const r = await refreshProducts(shopId, take.ids, deps, ctx);
        processed += take.ids.length;
        upserted += r.upserted;
        deleted += r.deleted;
      } catch (err) {
        // Không mất cập nhật: trả ID về set chờ rồi để BullMQ retry.
        await deps.redis.sadd(pendingKey(shopId), ...take.ids);
        throw err;
      }
    } while (remaining > 0 && clock.now() - started < budget);
    if (remaining > 0) await deps.schedule(shopId, 1_000);
    return { mode: "batches", processed, upserted, deleted, remaining };
  } finally {
    await release();
  }
}
