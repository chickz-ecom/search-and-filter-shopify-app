import { Worker } from "bullmq";
import {
  bullPrefix,
  closeQueues,
  getMaintQueue,
  MAINT_QUEUE,
  queueConnection,
  SYNC_QUEUE,
  type MaintJobData,
  type SyncJobData,
} from "../app/lib/queue/queue.server";
import { closeRedis } from "../app/lib/redis.server";
import { notifier } from "./context";
import { handleMaintJob, handleSyncJob } from "./handlers";

// Process worker (D4): `npm run worker`. Chạy tách khỏi admin và search-api.

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 8);

const syncWorker = new Worker<SyncJobData>(SYNC_QUEUE, (job) => handleSyncJob(job), {
  connection: queueConnection(),
  prefix: bullPrefix(),
  concurrency,
  // Full sync có thể chạy lâu; gia hạn lock để BullMQ không coi là stalled.
  lockDuration: 5 * 60_000,
});

const maintWorker = new Worker<MaintJobData>(MAINT_QUEUE, (job) => handleMaintJob(job), {
  connection: queueConnection(),
  prefix: bullPrefix(),
  concurrency: 2,
});

for (const w of [syncWorker, maintWorker]) {
  w.on("failed", (job, err) =>
    console.error(`[worker] ${job?.name} ${job?.id} failed:`, err.message),
  );
}

// Lịch định kỳ (mục 5.3): delta mỗi 5 phút (tick mỗi phút chọn shop đến hạn), checksum + best-selling đêm.
const maint = getMaintQueue();
await maint.upsertJobScheduler(
  "tick-delta",
  { every: 60_000 },
  { name: "tick-delta", data: { type: "tick-delta" } },
);
await maint.upsertJobScheduler(
  "tick-nightly",
  { pattern: "0 3 * * *", tz: "UTC" },
  { name: "tick-nightly", data: { type: "tick-nightly" } },
);
await maint.upsertJobScheduler(
  "tick-cleanup",
  { every: 60 * 60_000 },
  { name: "tick-cleanup", data: { type: "tick-cleanup" } },
);
await maint.upsertJobScheduler(
  "rollup-analytics",
  { every: 10 * 60_000 },
  { name: "rollup-analytics", data: { type: "rollup-analytics" } },
);

console.log(`[worker] started (sync concurrency ${concurrency})`);

async function shutdown() {
  await Promise.allSettled([syncWorker.close(), maintWorker.close()]);
  await notifier.close();
  await closeQueues();
  await closeRedis();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
