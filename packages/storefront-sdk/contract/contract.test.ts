import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { diffSurface, extractSurface, type Surface } from "./surface";

// Task 4.3: SDK v1 không được đổi chữ ký theo kiểu phá vỡ mà không nâng major (D16, docs/developers/README.md).

const pkg = JSON.parse(readFileSync("packages/storefront-sdk/package.json", "utf8")) as {
  version: string;
};
const major = pkg.version.split(".")[0];
const snapshotFile = `packages/storefront-sdk/contract/v${major}.json`;

describe("SDK public API contract", () => {
  let current: Surface;
  beforeAll(() => {
    // Luôn dựng lại .d.ts từ nguồn để không so với bản build cũ. Lỗi kiểu (nếu có) do bước typecheck báo;
    // tsc vẫn phát .d.ts nên ở đây chỉ so hợp đồng.
    spawnSync("npx", ["tsc", "-p", "packages/storefront-sdk/tsconfig.build.json"], {
      stdio: "pipe",
    });
    current = extractSurface("packages/storefront-sdk/dist/types.d.ts");
  }, 60_000);

  it(`has a recorded baseline for major ${major}`, () => {
    expect(existsSync(snapshotFile), `New major version: record it with npm run sdk:snapshot`).toBe(
      true,
    );
  });

  it("has no breaking change within the major version", () => {
    const snap = JSON.parse(readFileSync(snapshotFile, "utf8")) as { surface: Surface };
    const { breaking } = diffSurface(snap.surface, current);
    expect(
      breaking,
      `Breaking SDK change in v${major}. Keep the old signature (deprecate it for 90 days) or release v${Number(major) + 1}.`,
    ).toEqual([]);
  });

  it("records additions deliberately (snapshot + changelog entry)", () => {
    const snap = JSON.parse(readFileSync(snapshotFile, "utf8")) as {
      version: string;
      surface: Surface;
    };
    const { additions } = diffSurface(snap.surface, current);
    expect(
      additions,
      "SDK API additions: add a CHANGELOG entry, bump the minor version, run npm run sdk:snapshot",
    ).toEqual([]);
    expect(snap.version).toBe(pkg.version);
    expect(readFileSync("docs/developers/CHANGELOG.md", "utf8")).toContain(`## [${pkg.version}]`);
  });
});

describe("contract classifier", () => {
  const base: Surface = {
    SearchParams: {
      kind: "interface",
      extends: [],
      members: { q: { type: "string", optional: true } },
    },
    SearchResponse: {
      kind: "interface",
      extends: [],
      members: { total: { type: "number", optional: false } },
    },
    SearchAppEvent: { kind: "alias", text: '"ready" | "results"' },
  };
  const clone = (): Surface => JSON.parse(JSON.stringify(base));

  it("treats removals, type changes and new required inputs as breaking", () => {
    const a = clone();
    delete (a.SearchResponse as { members: Record<string, unknown> }).members.total;
    expect(diffSurface(base, a).breaking).toEqual(["SearchResponse.total: removed"]);

    const b = clone();
    (
      b.SearchParams as { members: Record<string, { type: string; optional: boolean }> }
    ).members.q.type = "number";
    expect(diffSurface(base, b).breaking).toEqual(["SearchParams.q: string → number"]);

    const c = clone();
    (
      c.SearchParams as { members: Record<string, { type: string; optional: boolean }> }
    ).members.page = {
      type: "number",
      optional: false,
    };
    expect(diffSurface(base, c).breaking).toEqual(["SearchParams.page: new required input"]);

    const d = clone();
    (
      d.SearchResponse as { members: Record<string, { type: string; optional: boolean }> }
    ).members.total.optional = true;
    expect(diffSurface(base, d).breaking).toEqual(["SearchResponse.total: may now be missing"]);

    const e = clone();
    delete e.SearchAppEvent;
    expect(diffSurface(base, e).breaking).toEqual(["SearchAppEvent: removed"]);
  });

  it("treats new optional inputs, new output fields, new events and new types as additions", () => {
    const a = clone();
    (
      a.SearchParams as { members: Record<string, { type: string; optional: boolean }> }
    ).members.page = {
      type: "number",
      optional: true,
    };
    (
      a.SearchResponse as { members: Record<string, { type: string; optional: boolean }> }
    ).members.took = {
      type: "number",
      optional: false,
    };
    a.SearchAppEvent = { kind: "alias", text: '"ready" | "results" | "error"' };
    a.NewThing = { kind: "alias", text: "string" };
    const d = diffSurface(base, a);
    expect(d.breaking).toEqual([]);
    expect(d.additions.sort()).toEqual(
      [
        "NewThing: new type",
        'SearchAppEvent: "ready" | "results" | "error"',
        "SearchParams.page",
        "SearchResponse.took",
      ].sort(),
    );
  });
});
