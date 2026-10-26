import { describe, expect, it } from "vitest";
import { Registry } from "./metrics";

describe("metrics registry (6.1)", () => {
  it("renders counters, gauges and histograms in Prometheus text format", async () => {
    const r = new Registry();
    const c = r.counter("searchapp_requests_total", "Requests", ["route"]);
    c.inc({ route: "/v1/search" });
    c.inc({ route: "/v1/search" }, 2.5);
    const g = r.gauge("searchapp_queue_jobs", "Jobs", ["queue", "state"], async () => [
      { labels: { queue: "sync", state: "waiting" }, value: 7 },
    ]);
    g.set({ queue: "maint", state: "failed" }, 1);
    const h = r.histogram("searchapp_latency_seconds", "Latency", ["route"], [0.05, 0.1, 0.5]);
    for (const v of [0.01, 0.07, 0.2, 2]) h.observe({ route: "/v1/search" }, v);
    const text = await r.render();
    expect(text).toContain("# TYPE searchapp_requests_total counter");
    expect(text).toContain('searchapp_requests_total{route="/v1/search"} 3.5');
    expect(text).toContain('searchapp_queue_jobs{queue="sync",state="waiting"} 7');
    expect(text).toContain('searchapp_queue_jobs{queue="maint",state="failed"} 1');
    expect(text).toContain('searchapp_latency_seconds_bucket{route="/v1/search",le="0.05"} 1');
    expect(text).toContain('searchapp_latency_seconds_bucket{route="/v1/search",le="0.1"} 2');
    expect(text).toContain('searchapp_latency_seconds_bucket{route="/v1/search",le="+Inf"} 4');
    expect(text).toContain('searchapp_latency_seconds_count{route="/v1/search"} 4');
    expect(text).toMatch(/searchapp_latency_seconds_sum\{route="\/v1\/search"\} 2\.28/);
  });

  it("escapes label values and estimates quantiles for local reports", () => {
    const r = new Registry();
    const c = r.counter("x_total", "x", ["q"]);
    c.inc({ q: 'a"b\\c' });
    expect(r.renderSync()).toContain('x_total{q="a\\"b\\\\c"} 1');
    const h = r.histogram("lat", "l", [], [0.01, 0.05, 0.1, 0.25]);
    for (let i = 0; i < 100; i++) h.observe({}, i < 96 ? 0.02 : 0.2);
    expect(h.quantile({}, 0.95)).toBeLessThanOrEqual(0.05);
    expect(h.quantile({}, 0.99)).toBeGreaterThan(0.1);
  });
});
