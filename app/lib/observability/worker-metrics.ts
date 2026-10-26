import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Db } from "../shop/shop.server";
import { Registry, SYNC_BUCKETS } from "./metrics";

// Metrics của worker (task 6.1): độ sâu queue, độ trễ sync (sự kiện → index), độ trễ watermark delta, lỗi job.
// Phơi qua HTTP nhỏ: GET /metrics (Bearer METRICS_TOKEN) và GET /health (liveness cho orchestrator).

type JobLike = {
  name: string;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  data: { type: string };
};
type QueueLike = {
  name: string;
  getJobCounts(...states: string[]): Promise<Record<string, number>>;
};

/** Job sinh từ sự kiện của Shopify (webhook/Events) — đo từ lúc xếp hàng tới lúc index xong. */
const EVENT_JOBS = new Set(["incremental", "inventory", "collection", "delete"]);
const STATES = ["waiting", "active", "delayed", "failed"];

export function createWorkerMetrics(deps: { db: Db; queues: QueueLike[]; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const registry = new Registry();
  registry.gauge(
    "searchapp_queue_jobs",
    "BullMQ jobs by queue and state",
    ["queue", "state"],
    async () => {
      const out: { labels: Record<string, string>; value: number }[] = [];
      for (const q of deps.queues) {
        const counts = await q.getJobCounts(...STATES);
        for (const s of STATES)
          out.push({ labels: { queue: q.name, state: s }, value: counts[s] ?? 0 });
      }
      return out;
    },
  );
  registry.gauge(
    "searchapp_delta_lag_seconds",
    "Oldest delta-sync watermark among active shops (now - lastSyncedUpdatedAt)",
    [],
    async () => {
      const r = await deps.db.shop.aggregate({
        where: {
          uninstalledAt: null,
          lastFullSyncAt: { not: null },
          syncState: { notIn: ["RUNNING", "QUEUED"] },
        },
        _min: { lastSyncedUpdatedAt: true },
      });
      const oldest = r._min.lastSyncedUpdatedAt;
      return [{ labels: {}, value: oldest ? Math.max(0, (now() - oldest.getTime()) / 1000) : 0 }];
    },
  );
  const duration = registry.histogram(
    "searchapp_job_duration_seconds",
    "Job processing time",
    ["type"],
    SYNC_BUCKETS,
  );
  const eventToIndex = registry.histogram(
    "searchapp_event_to_index_seconds",
    "Shopify event enqueued → product searchable (incl. debounce)",
    ["type"],
    SYNC_BUCKETS,
  );
  const failures = registry.counter("searchapp_job_failures_total", "Failed job attempts", [
    "type",
  ]);

  return {
    registry,
    onCompleted(job: JobLike) {
      const type = job.data?.type ?? job.name;
      const end = job.finishedOn ?? now();
      if (job.processedOn) duration.observe({ type }, (end - job.processedOn) / 1000);
      if (EVENT_JOBS.has(type)) eventToIndex.observe({ type }, (end - job.timestamp) / 1000);
    },
    onFailed(job: JobLike | undefined) {
      failures.inc({ type: job?.data?.type ?? job?.name ?? "unknown" });
    },
  };
}

export function serveMetrics(registry: Registry, opts: { port: number; token: string }): Server {
  const expected = Buffer.from(`Bearer ${opts.token}`);
  return createServer(async (req, res) => {
    if (req.url === "/health") return res.writeHead(200).end("ok");
    if (req.url !== "/metrics" || !opts.token) return res.writeHead(404).end();
    const got = Buffer.from(req.headers.authorization ?? "");
    if (got.length !== expected.length || !timingSafeEqual(got, expected))
      return res.writeHead(401).end();
    res
      .writeHead(200, { "Content-Type": "text/plain; version=0.0.4" })
      .end(await registry.render());
  }).listen(opts.port);
}
