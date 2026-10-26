import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Contract test cho theme app extension (D10, giới hạn deploy ở docs/shopify-api/config-extensions.md mục 4).
const root = "extensions/search-theme";
const blocks = readdirSync(join(root, "blocks")).filter((f) => f.endsWith(".liquid"));
const schemaOf = (file: string) => {
  const src = readFileSync(join(root, "blocks", file), "utf8");
  const m = /\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/.exec(src);
  return JSON.parse(m![1]) as {
    name: string;
    target: string;
    javascript?: string;
    stylesheet?: string;
    enabled_on?: { templates: string[] };
  };
};
const allLiquid = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? allLiquid(p) : p.endsWith(".liquid") ? [p] : [];
  });

describe("theme app extension", () => {
  it("has 1 app embed (body) and app blocks targeting content", () => {
    const schemas = blocks.map((b) => [b, schemaOf(b)] as const);
    expect(schemas.filter(([, s]) => s.target === "body").map(([b]) => b)).toEqual([
      "app-embed.liquid",
    ]);
    expect(
      schemas
        .filter(([, s]) => s.target === "content")
        .map(([b]) => b)
        .sort(),
    ).toEqual(["collection-filter.liquid", "search-results.liquid"]);
    expect(blocks.length).toBeLessThanOrEqual(30);
    for (const [, s] of schemas) expect(s.name.length).toBeLessThan(25);
  });

  it("references assets that exist (after build) and stays under the Liquid size limit", () => {
    for (const b of blocks) {
      const s = schemaOf(b);
      for (const a of [s.javascript, s.stylesheet].filter(Boolean) as string[]) {
        expect(existsSync(join(root, "assets", a)), `${b} → assets/${a}`).toBe(true);
      }
      const src = readFileSync(join(root, "blocks", b), "utf8");
      for (const m of src.matchAll(/'([\w.-]+\.(?:js|css))'\s*\|\s*asset_url/g)) {
        expect(existsSync(join(root, "assets", m[1])), `${b} → ${m[1]}`).toBe(true);
      }
    }
    const total = allLiquid(root).reduce((s, f) => s + statSync(f).size, 0);
    expect(total).toBeLessThan(100 * 1024);
  });

  it("never uses ScriptTag-era patterns (parser-blocking external scripts, Asset API)", () => {
    for (const f of allLiquid(root)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<script\s+src=[^>]*>/g))
        expect(m[0], f).toMatch(/\b(defer|async)\b/);
    }
  });

  it("ships locale files for en (default) and vi with the same keys", () => {
    const en = JSON.parse(readFileSync(join(root, "locales/en.default.json"), "utf8"));
    const vi = JSON.parse(readFileSync(join(root, "locales/vi.json"), "utf8"));
    expect(Object.keys(vi.searchapp).sort()).toEqual(Object.keys(en.searchapp).sort());
  });
});
