import { describe, expect, it } from "vitest";
import { fetchPercent, indexPercent, progressReporter, type SyncProgress } from "./progress";

describe("sync progress", () => {
  it("maps phases onto one bar: fetch 5–70, index 70–98", () => {
    expect(fetchPercent(0, 3)).toBe(5);
    expect(fetchPercent(3, 3)).toBe(70);
    expect(indexPercent(0, 100)).toBe(70);
    expect(indexPercent(50, 100)).toBe(84);
    expect(indexPercent(500, 100)).toBe(98);
    expect(indexPercent(10, 0)).toBe(98);
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
    report({ phase: "fetch", percent: 20, fetched: 40 }); // < 1s cùng phase → bỏ
    t = 1300;
    report({ phase: "fetch", percent: 26.6, fetched: 80 });
    t = 1400;
    report({ phase: "index", percent: 70 }); // đổi phase → ghi ngay
    t = 2600;
    report({ phase: "index", percent: 60 }); // không lùi
    expect(writes).toEqual([
      { phase: "fetch", percent: 5 },
      { phase: "fetch", percent: 27, fetched: 80 },
      { phase: "index", percent: 70 },
      { phase: "index", percent: 70 },
    ]);
  });
});
