import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";

// 6.5: giới hạn của form nộp App Store (shopify.dev "App Store listing" — introduction 100, details 500,
// mỗi tính năng 80 ký tự; ảnh 1600×900, 3–6 ảnh, có alt).
const L = JSON.parse(readFileSync("docs/app-store/listing.json", "utf8"));

function pngSize(path: string) {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe("App Store listing", () => {
  it("respects field limits and naming rules", () => {
    expect(L.introduction.length).toBeLessThanOrEqual(100);
    expect(L.details.length).toBeLessThanOrEqual(500);
    for (const f of L.features) expect(f.length, f).toBeLessThanOrEqual(80);
    expect(L.appName).not.toMatch(/shopify/i);
    const toml = parseToml(readFileSync("shopify.app.toml", "utf8")) as { name: string };
    expect(toml.name).toBe(L.appName);
  });

  it("has 3–6 unique 1600×900 screenshots with alt text", () => {
    expect(L.screenshots.length).toBeGreaterThanOrEqual(3);
    expect(L.screenshots.length).toBeLessThanOrEqual(6);
    expect(new Set(L.screenshots.map((s: { file: string }) => s.file)).size).toBe(
      L.screenshots.length,
    );
    for (const s of L.screenshots) {
      expect(s.alt.length, s.file).toBeGreaterThan(20);
      expect(pngSize(`docs/app-store/${s.file}`)).toEqual({ width: 1600, height: 900 });
    }
  });
});
