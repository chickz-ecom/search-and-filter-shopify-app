import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Hợp đồng tài liệu (4.1): openapi.yaml phải khớp route và mã lỗi thật của search-api.
const spec = parse(readFileSync("docs/developers/openapi.yaml", "utf8"));
const app = readFileSync("services/search-api/src/app.ts", "utf8");

describe("OpenAPI spec", () => {
  it("documents every public /v1 route with the right method", () => {
    const routes = [...app.matchAll(/app\.(get|post)\("(\/v1\/[a-z]+)"/g)].map(
      ([, m, p]) => `${m} ${p}`,
    );
    expect(routes.length).toBeGreaterThanOrEqual(5);
    const documented = Object.entries(
      spec.paths as Record<string, Record<string, unknown>>,
    ).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m} ${p}`));
    expect(documented.sort()).toEqual(routes.sort());
  });

  it("lists every error code the public routes return", () => {
    const v1 = app.slice(app.indexOf('app.use("/v1/*"'));
    const codes = new Set([...v1.matchAll(/error: "([a-z_]+)"/g)].map((m) => m[1]));
    for (const m of app.matchAll(/^\s+([a-z_]+): "[A-Z]/gm)) codes.add(`headless_${m[1]}`);
    codes.add("engine_unavailable");
    const documented: string[] = spec.components.schemas.Error.properties.error.enum;
    for (const c of codes) expect(documented, c).toContain(c);
  });

  it("resolves every $ref", () => {
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1]);
    for (const r of refs) {
      const target = r
        .split("/")
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], spec);
      expect(target, r).toBeDefined();
    }
  });
});
