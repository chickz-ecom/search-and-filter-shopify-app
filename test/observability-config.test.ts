import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// 6.1: alert rule chỉ được tham chiếu metric có thật (đổi tên metric mà quên alert → alert im lặng mãi mãi).
const sources = ["services/search-api/src/app.ts", "app/lib/observability/worker-metrics.ts"].map(
  (f) => readFileSync(f, "utf8"),
);

describe("observability config", () => {
  it("alerts.yml parses and only uses metrics the code exports", () => {
    const alerts = parse(readFileSync("deploy/observability/alerts.yml", "utf8"));
    const rules = alerts.groups.flatMap(
      (g: { rules: { alert: string; expr: string }[] }) => g.rules,
    );
    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const r of rules) {
      const names = [...r.expr.matchAll(/searchapp_[a-z_]+/g)].map((m) =>
        m[0].replace(/_(bucket|count|sum)$/, ""),
      );
      expect(names.length, r.alert).toBeGreaterThan(0);
      for (const n of names)
        expect(
          sources.some((s) => s.includes(`"${n}"`)),
          `${r.alert}: ${n}`,
        ).toBe(true);
    }
  });

  it("prometheus.yml scrapes both processes with a token", () => {
    const prom = parse(readFileSync("deploy/observability/prometheus.yml", "utf8"));
    expect(prom.scrape_configs.map((s: { job_name: string }) => s.job_name)).toEqual([
      "search-api",
      "worker",
    ]);
    for (const s of prom.scrape_configs) expect(s.authorization.credentials_file).toBeTruthy();
  });
});
