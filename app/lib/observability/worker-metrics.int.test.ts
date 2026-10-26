import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { ensureShop } from "../shop/shop.server";
import { createWorkerMetrics, serveMetrics } from "./worker-metrics";

const up = await postgresUp();

describe.skipIf(!up)("worker metrics (6.1)", () => {
  const domain = `met-${Date.now()}.myshopify.com`;
  const now = Date.parse("2030-01-01T00:10:00Z");
  beforeAll(async () => {
    const { shop } = await ensureShop(testDb(), domain);
    await testDb().shop.update({
      where: { id: shop.id },
      data: {
        lastFullSyncAt: new Date(now - 86_400_000),
        lastSyncedUpdatedAt: new Date(now - 40 * 86_400_000),
        syncState: "IDLE",
      },
    });
  });
  afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

  it("reports queue depth, delta lag, job duration, event-to-index latency and failures", async () => {
    const queue = {
      name: "sync",
      getJobCounts: async () => ({ waiting: 12, active: 3, delayed: 1, failed: 2 }),
    };
    const m = createWorkerMetrics({ db: testDb(), queues: [queue], now: () => now });
    m.onCompleted({
      name: "incremental",
      timestamp: now - 3200,
      processedOn: now - 200,
      finishedOn: now,
      data: { type: "incremental" },
    });
    m.onCompleted({
      name: "full",
      timestamp: now - 90_000,
      processedOn: now - 60_000,
      finishedOn: now,
      data: { type: "full" },
    });
    m.onFailed({ name: "delta", timestamp: now, data: { type: "delta" } });
    const text = await m.registry.render();
    expect(text).toContain('searchapp_queue_jobs{queue="sync",state="waiting"} 12');
    expect(text).toContain('searchapp_queue_jobs{queue="sync",state="failed"} 2');
    // Shop cũ nhất (watermark 40 ngày) quyết định độ trễ — có shop khác trong DB test nên chỉ kiểm ≥.
    const lag = Number(/searchapp_delta_lag_seconds (\d+(\.\d+)?)/.exec(text)![1]);
    expect(lag).toBeGreaterThanOrEqual(40 * 86_400);
    expect(text).toContain('searchapp_event_to_index_seconds_bucket{type="incremental",le="5"} 1');
    expect(text).toContain('searchapp_event_to_index_seconds_count{type="incremental"} 1');
    expect(text).not.toContain('searchapp_event_to_index_seconds_count{type="full"}');
    expect(text).toContain('searchapp_job_duration_seconds_count{type="full"} 1');
    expect(text).toContain('searchapp_job_failures_total{type="delta"} 1');
  });

  it("serves /metrics behind a bearer token and /health", async () => {
    const m = createWorkerMetrics({ db: testDb(), queues: [] });
    const server = serveMetrics(m.registry, { port: 0, token: "t0k" });
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await fetch(`${base}/metrics`)).status).toBe(401);
      const ok = await fetch(`${base}/metrics`, { headers: { Authorization: "Bearer t0k" } });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("# TYPE searchapp_delta_lag_seconds gauge");
    } finally {
      server.close();
    }
  });
});
