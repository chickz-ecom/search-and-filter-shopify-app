import { describe, expect, it } from "vitest";
import {
  fetchPercent,
  fetchProgress,
  indexPercent,
  progressReporter,
  type SyncProgress,
} from "./progress";

describe("sync progress", () => {
  it("maps phases onto one bar: fetch 5–70, index 70–98", () => {
    expect(fetchPercent(0, 3)).toBe(5);
    expect(fetchPercent(3, 3)).toBe(70);
    expect(indexPercent(0, 100)).toBe(70);
    expect(indexPercent(50, 100)).toBe(84);
    expect(indexPercent(500, 100)).toBe(98);
    expect(indexPercent(10, 0)).toBe(98);
  });

  it("counts products (not every bulk row) and moves the bar while the product bulk runs", () => {
    // 1 bulk sản phẩm đang chạy (500/1000), variants + collections chưa xong → objectCount của chúng không tính.
    const bulks = new Map([
      ["products", { objects: 500, done: false }],
      ["variants", { objects: 90_000, done: false }],
      ["collections", { objects: 800_000, done: false }],
    ]);
    expect(fetchProgress(bulks, 1000)).toEqual({
      percent: fetchPercent(0.5, 3),
      bulks: {
        products: { n: 500, done: false },
        variants: { n: 90_000, done: false },
        collections: { n: 800_000, done: false },
      },
    });
    // Shard: 2 bulk sản phẩm, một xong một đang chạy; số sản phẩm không vượt tổng.
    const shards = new Map([
      ["products#1", { objects: 600, done: true }],
      ["products#2", { objects: 700, done: false }],
      ["variants#1", { objects: 5, done: true }],
    ]);
    expect(fetchProgress(shards, 1200, 5).bulks).toEqual({
      products: { n: 1200, done: false },
      variants: { n: 5, done: true },
    });
  });

  it("throttles writes within a phase, writes phase changes at once, never goes backwards", () => {
    const writes: SyncProgress[] = [];
    let t = 0;
    const report = progressReporter(
      async (p) => void writes.push(p),
      () => t,
    );
    report({ phase: "fetch", percent: 5 });
    t = 200;
    report({ phase: "fetch", percent: 20, bulks: { products: { n: 40, done: false } } }); // < 1s cùng phase → bỏ
    t = 1300;
    report({ phase: "fetch", percent: 26.6, bulks: { products: { n: 80, done: false } } });
    t = 1400;
    report({ phase: "index", percent: 70 }); // đổi phase → ghi ngay
    t = 2600;
    report({ phase: "index", percent: 60 }); // không lùi
    expect(writes).toEqual([
      { phase: "fetch", percent: 5 },
      { phase: "fetch", percent: 27, bulks: { products: { n: 80, done: false } } },
      { phase: "index", percent: 70 },
      { phase: "index", percent: 70 },
    ]);
  });
});
