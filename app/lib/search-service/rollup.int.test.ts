import { afterAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { testRedis } from "../../../test/redis";
import { postgresUp, redisUp } from "../../../test/services";
import { ensureShop } from "../shop/shop.server";
import { pendingDaysKey, recordEvents } from "./analytics.server";
import { parseCounters, rollupAnalytics } from "./rollup.server";

const up = (await postgresUp()) && (await redisUp());

describe("analytics rollup (2.13)", () => {
  it("parses counter fields", () => {
    const { queries, usage } = parseCounters({
      "s|tee": "5",
      "z|tee": "1",
      "c|tee": "2",
      "a|tee": "1",
      "r|tee": "49.5",
      "f|vendor|Nike": "3",
      "o|price_asc": "4",
    });
    expect(queries.get("tee")).toEqual({
      searches: 5,
      zeroResults: 1,
      clicks: 2,
      addToCarts: 1,
      revenue: 49.5,
      productsBought: 0,
      orders: 0,
    });
    expect(usage).toEqual([
      { kind: "FILTER", scope: "", key: "vendor", value: "Nike", count: 3 },
      { kind: "SORT", scope: "", key: "price_asc", value: "", count: 4 },
    ]);
  });

  describe.skipIf(!up)("live", () => {
    const domain = `an-${Date.now()}.myshopify.com`;
    afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

    it("skips a shop deleted between the existence check and the write (FK race)", async () => {
      const shopId = `gone-${Date.now()}`;
      await recordEvents(testRedis(), shopId, [{ type: "search", query: "x", results: 1 }]);
      const fk = Object.assign(new Error("fk"), { code: "P2003" });
      // Shop khác (của test chạy song song) đi qua DB thật như bình thường — rollup là idempotent.
      const real = testDb();
      type Args = { where: { id?: string; shopId_date_query?: { shopId: string } } };
      const db = {
        shop: {
          findUnique: (a: Args) =>
            a.where.id === shopId ? { id: shopId } : real.shop.findUnique(a as never),
        },
        analyticsDaily: {
          upsert: async (a: Args) => {
            if (a.where.shopId_date_query?.shopId === shopId) throw fk;
            return real.analyticsDaily.upsert(a as never);
          },
        },
        analyticsUsageDaily: real.analyticsUsageDaily,
      } as unknown as Parameters<typeof rollupAnalytics>[1];
      await expect(rollupAnalytics(testRedis(), db)).resolves.toBeDefined();
      const pending = await testRedis().smembers(pendingDaysKey);
      expect(pending.some((e) => e.startsWith(`${shopId}|`))).toBe(false);
    });

    it("writes idempotent daily rows and finalizes past days", async () => {
      const { shop } = await ensureShop(testDb(), domain);
      const yesterday = new Date(Date.now() - 24 * 3600_000);
      await recordEvents(
        testRedis(),
        shop.id,
        [
          { type: "search", query: "Tee", results: 3 },
          { type: "search", query: "tee", results: 3 },
          { type: "search", query: "xyz", results: 0 },
          { type: "click", query: "tee", productId: "1", source: "search" },
          { type: "click", productId: "1", source: "collection", collectionId: "9" },
          { type: "collection_view", collectionId: "9" },
          {
            type: "purchase",
            query: "tee",
            revenue: 20,
            items: [{ productId: "1", qty: 2, revenue: 20 }],
          },
          { type: "filter", key: "vendor", value: "Nike" },
          { type: "sort", key: "price_asc" },
        ],
        yesterday,
      );
      await rollupAnalytics(testRedis(), testDb());
      await rollupAnalytics(testRedis(), testDb()); // chạy lại không nhân đôi
      const rows = await testDb().analyticsDaily.findMany({
        where: { shopId: shop.id },
        orderBy: { query: "asc" },
      });
      expect(
        rows.map((r) => [
          r.query,
          r.searches,
          r.zeroResults,
          r.clicks,
          Number(r.revenueShopCurrency),
        ]),
      ).toEqual([
        ["", 0, 0, 1, 0],
        ["tee", 2, 0, 1, 20],
        ["xyz", 1, 1, 0, 0],
      ]);
      const usage = await testDb().analyticsUsageDaily.findMany({ where: { shopId: shop.id } });
      expect(usage.map((u) => [u.kind, u.key, u.value, u.count]).sort()).toEqual([
        ["FILTER", "vendor", "Nike", 1],
        ["SORT", "price_asc", "", 1],
      ]);
      // 7.1: bảng theo sản phẩm và theo collection.
      const products = await testDb().analyticsProductDaily.findMany({
        where: { shopId: shop.id },
      });
      expect(
        products.map((p) => [
          p.productId,
          p.clicks,
          p.searchClicks,
          p.collectionClicks,
          p.purchases,
          Number(p.revenue),
        ]),
      ).toEqual([["1", 2, 1, 1, 2, 20]]);
      const cols = await testDb().analyticsCollectionDaily.findMany({ where: { shopId: shop.id } });
      expect(cols.map((c) => [c.collectionId, c.views, c.clicks])).toEqual([["9", 1, 1]]);
      expect(rows.find((r) => r.query === "tee")).toMatchObject({ productsBought: 2, orders: 1 });
      expect(
        await testRedis().sismember(
          `${process.env.REDIS_PREFIX}:an:pending`,
          `${shop.id}|${yesterday.toISOString().slice(0, 10)}`,
        ),
      ).toBe(0);
    });
  });
});
