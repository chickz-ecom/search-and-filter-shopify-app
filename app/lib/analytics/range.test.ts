import { describe, expect, it } from "vitest";
import { daysIn, parseDateRange, presetRange, rangeBounds } from "./range";

const now = new Date("2026-10-26T15:00:00Z");

describe("analytics date range", () => {
  it("defaults to the last 30 days including today", () => {
    expect(parseDateRange(new URLSearchParams(), now)).toEqual({
      from: "2026-09-27",
      to: "2026-10-26",
    });
  });

  it("reads from/to, swaps reversed dates, caps the span and rejects junk", () => {
    const p = (q: string) => parseDateRange(new URLSearchParams(q), now);
    expect(p("from=2026-10-01&to=2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(p("from=2026-10-31&to=2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(p("from=2020-01-01&to=2026-10-26")).toEqual({ from: "2025-10-26", to: "2026-10-26" });
    expect(p("from=2026-02-30&to=x")).toEqual({ from: "2026-09-27", to: "2026-10-26" });
  });

  it("lists every day for chart series and gives exclusive DB bounds", () => {
    const r = { from: "2026-10-30", to: "2026-11-02" };
    expect(daysIn(r)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(rangeBounds(r)).toEqual({
      gte: new Date("2026-10-30T00:00:00Z"),
      lt: new Date("2026-11-03T00:00:00Z"),
    });
  });

  it("builds presets", () => {
    expect(presetRange("today", now)).toEqual({ from: "2026-10-26", to: "2026-10-26" });
    expect(presetRange("last7", now)).toEqual({ from: "2026-10-20", to: "2026-10-26" });
    expect(presetRange("thisMonth", now)).toEqual({ from: "2026-10-01", to: "2026-10-26" });
    expect(presetRange("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});
