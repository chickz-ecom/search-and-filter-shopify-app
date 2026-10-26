import { Queue, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";
import { env } from "../env.server";
import { createRedis, redis, rkey } from "../redis.server";

// Hàng đợi (D4). Webhook/Event chỉ ghi tín hiệu vào đây rồi trả 200 (D7); worker xử lý idempotent.

export const SYNC_QUEUE = "sync";
export const MAINT_QUEUE = "maintenance";

export type SyncJobData =
  | { type: "full"; shopId: string; reason: string; syncJobId?: string }
  | { type: "incremental"; shopId: string }
  | { type: "delete"; shopId: string; productIds: string[] }
  | {
      type: "collection";
      shopId: string;
      collectionId: string;
      added?: string[];
      removed?: string[];
      sortOrder?: string | null;
      deleted?: boolean;
    }
  | { type: "inventory"; shopId: string; inventoryItemIds: string[] }
  | { type: "delta"; shopId: string }
  | { type: "checksum"; shopId: string }
  | { type: "shop-refresh"; shopId: string; what: ("markets" | "locales" | "shop")[] }
  | { type: "best-selling"; shopId: string }
  | { type: "uninstall"; shopId: string }
  | { type: "redact"; shopDomain: string };

export type MaintJobData =
  | { type: "tick-delta" }
  | { type: "tick-nightly" }
  | { type: "tick-cleanup" }
  | { type: "rollup-analytics" }
  | { type: "refresh-plans" };

let syncQueue: Queue<SyncJobData> | undefined;
let maintQueue: Queue<MaintJobData> | undefined;
let queueConn: Redis | undefined;

function bullPrefix() {
  return `${env().REDIS_PREFIX}:bull`;
}

export function queueConnection(): Redis {
  queueConn ??= createRedis();
  return queueConn;
}

export function getSyncQueue(): Queue<SyncJobData> {
  syncQueue ??= new Queue<SyncJobData>(SYNC_QUEUE, {
    connection: queueConnection(),
    prefix: bullPrefix(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return syncQueue;
}

export function getMaintQueue(): Queue<MaintJobData> {
  maintQueue ??= new Queue<MaintJobData>(MAINT_QUEUE, {
    connection: queueConnection(),
    prefix: bullPrefix(),
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
  return maintQueue;
}

export { bullPrefix };

/** Debounce incremental (mục 5.2): 3–5 giây. */
export const INCREMENTAL_DEBOUNCE_MS = 3_000;
/** Vượt ngưỡng → delta bulk thay cho gọi từng lô (mục 5.2 "đột biến"). */
export const SPIKE_THRESHOLD = 2_000;

export const pendingKey = (shopId: string) => rkey("inc", shopId, "pending");
export const scheduledKey = (shopId: string) => rkey("inc", shopId, "scheduled");

type Enqueuer = { add(name: string, data: SyncJobData, opts?: JobsOptions): Promise<unknown> };

/**
 * Gom product ID đổi vào set chờ; chỉ lên lịch một job/shop trong cửa sổ debounce.
 * Worker xoá cờ `scheduled` lúc bắt đầu → sự kiện đến trong lúc xử lý sẽ lên lịch job kế tiếp, không mất.
 */
export async function enqueueIncremental(
  shopId: string,
  productIds: string[],
  deps: { redis?: Redis; queue?: Enqueuer } = {},
): Promise<void> {
  if (!productIds.length) return;
  const r = deps.redis ?? redis();
  await r.sadd(pendingKey(shopId), ...productIds);
  await r.expire(pendingKey(shopId), 7 * 24 * 3600);
  const first = await r.set(scheduledKey(shopId), "1", "PX", INCREMENTAL_DEBOUNCE_MS * 10, "NX");
  if (first) {
    const q = deps.queue ?? getSyncQueue();
    await q.add(
      "incremental",
      { type: "incremental", shopId },
      { delay: INCREMENTAL_DEBOUNCE_MS, jobId: `inc-${shopId}-${Date.now()}` },
    );
  }
}

/** Lấy tối đa `max` ID chờ (SPOP nguyên tử). */
export async function takePending(
  r: Redis,
  shopId: string,
  max: number,
): Promise<{ ids: string[]; remaining: number }> {
  await r.del(scheduledKey(shopId));
  const ids = ((await r.spop(pendingKey(shopId), max)) as string[] | null) ?? [];
  const remaining = await r.scard(pendingKey(shopId));
  return { ids, remaining };
}

export async function enqueueSync(
  data: SyncJobData,
  opts: JobsOptions = {},
  queue: Enqueuer = getSyncQueue(),
) {
  await queue.add(data.type, data, opts);
}

/** Kênh pub/sub cho webhook bulk_operations/finish → BulkNotifier. */
export const bulkChannel = (bulkId: string) => rkey("bulk", bulkId);

export async function closeQueues() {
  await syncQueue?.close();
  await maintQueue?.close();
  await queueConn?.quit().catch(() => undefined);
  syncQueue = undefined;
  maintQueue = undefined;
  queueConn = undefined;
}
