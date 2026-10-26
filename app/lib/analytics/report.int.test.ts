import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { ensureShop } from "../shop/shop.server";
import { getAnalyticsReport, parseRange } from "./report.server";

const up = await postgresUp();
const now = new Date("2026-10-26T12:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe.skipIf(!up)("Analytics report (3.7)", () => {
  const domain = `ana-${Date.now()}.myshopify.com`;
  let shopId: string;

  beforeAll(async () => {
    shopId = (await ensureShop(testDb(), domain)).shop.id;
    const rows = [
      ["2026-10-25", "tee", 10, 0, 4, 1, 25],
      ["2026-10-26", "tee", 6, 0, 2, 0, 0],
      ["2026-10-26", "jeans", 8, 0, 1, 1, 59.9],
      ["2026-10-26", "sneekers", 5, 5, 0, 0, 0],
      ["2026-10-24", "sneekers", 2, 2, 0, 0, 0],
      ["2026-10-26", "", 20, 0, 3, 0, 0],
      ["2026-09-01", "old", 99, 99, 0, 0, 0], // ngoài khoảng 30 ngày
    ] as const;
    await testDb().analyticsDaily.createMany({
      data: rows.map(([d, query, searches, zeroResults, clicks, addToCarts, revenue]) => ({
        shopId,
        date: day(d),
        query,
        searches,
        zeroResults,
        clicks,
        addToCarts,
        revenueShopCurrency: revenue,
      })),
    });
    await testDb().analyticsUsageDaily.createMany({
      data: [
        {
          shopId,
          date: day("2026-10-26"),
          kind: "FILTER",
          key: "filter.p.vendor",
          value: "Acme",
          count: 6,
        },
        {
          shopId,
          date: day("2026-10-25"),
          kind: "FILTER",
          key: "filter.p.vendor",
          value: "Acme",
          count: 2,
        },
        {
          shopId,
          date: day("2026-10-26"),
          kind: "FILTER",
          key: "filter.x.unknown",
          value: "1",
          count: 2,
        },
        { shopId, date: day("2026-10-26"), kind: "SORT", key: "price_asc", value: "", count: 3 },
        { shopId, date: day("2026-10-26"), kind: "SORT", key: "created_desc", value: "", count: 1 },
      ],
    });
  });
  afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

  it("aggregates top queries over the range, skipping the empty query", async () => {
    const r = await getAnalyticsReport(testDb(), shopId, "en", 30, now);
    expect(r.topQueries.map((q) => q.query)).toEqual(["tee", "jeans", "sneekers"]);
    expect(r.topQueries[0]).toEqual({
      query: "tee",
      searches: 16,
      clicks: 6,
      ctr: 6 / 16,
      addToCarts: 1,
      revenue: 25,
    });
    expect(r.kpis.searches).toBe(51);
  });

  it("lists zero-result queries and filter/sort usage with labels and shares", async () => {
    const r = await getAnalyticsReport(testDb(), shopId, "vi", 30, now);
    expect(r.zeroResults).toEqual([{ query: "sneekers", searches: 7, zeroResults: 7 }]);
    expect(r.filterUsage[0]).toEqual({
      key: "filter.p.vendor",
      label: "Thương hiệu",
      value: "Acme",
      count: 8,
      share: 0.8,
    });
    expect(r.filterUsage[1].label).toBe("filter.x.unknown");
    expect(r.sortUsage.map((s) => [s.key, s.count, s.share])).toEqual([
      ["price_asc", 3, 0.75],
      ["created_desc", 1, 0.25],
    ]);
    expect(r.sortUsage[0].label).not.toBe("price_asc");
  });

  it("respects the 7-day range and parses the range param safely", async () => {
    const r = await getAnalyticsReport(testDb(), shopId, "en", 7, now);
    expect(r.zeroResults[0].zeroResults).toBe(7);
    expect((await getAnalyticsReport(testDb(), shopId, "en", 90, now)).zeroResults[0].query).toBe(
      "old",
    );
    expect(parseRange("7")).toBe(7);
    expect(parseRange("1000")).toBe(30);
    expect(parseRange(null)).toBe(30);
  });
});
