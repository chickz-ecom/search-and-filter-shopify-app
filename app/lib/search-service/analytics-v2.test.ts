import { describe, expect, it } from "vitest";
import { recordEvents } from "./analytics.server";
import { parseCounters } from "./rollup.server";

// Analytics v2 (7.1): sự kiện → bộ đếm Redis → số liệu theo query / sản phẩm / collection / ngữ cảnh filter.
function fakeRedis() {
  const hash: Record<string, number> = {};
  const m = {
    hincrby: (_k: string, f: string, n: number) => ((hash[f] = (hash[f] ?? 0) + n), m),
    hincrbyfloat: (_k: string, f: string, n: number) => ((hash[f] = (hash[f] ?? 0) + n), m),
    zincrby: () => m,
    expire: () => m,
    sadd: () => m,
    exec: async () => [],
  };
  return { redis: { multi: () => m } as never, hash };
}

async function counters(events: Parameters<typeof recordEvents>[2]) {
  const { redis, hash } = fakeRedis();
  await recordEvents(redis, "shop1", events);
  return parseCounters(Object.fromEntries(Object.entries(hash).map(([k, v]) => [k, String(v)])));
}

describe("analytics v2 counters", () => {
  it("counts product clicks by source and collection clicks", async () => {
    const c = await counters([
      { type: "click", query: "tee", productId: "11", source: "search" },
      { type: "click", productId: "11", source: "instant", query: "te" },
      { type: "click", productId: "11", source: "collection", collectionId: "77" },
      { type: "collection_view", collectionId: "77" },
      { type: "collection_view", collectionId: "gid://shopify/Collection/77" },
    ]);
    expect(c.products.get("11")).toMatchObject({ clicks: 3, searchClicks: 2, collectionClicks: 1 });
    expect(c.collections.get("77")).toMatchObject({ views: 2, clicks: 1 });
    expect(c.queries.get("tee")?.clicks).toBe(1);
  });

  it("attributes a purchase to the query or collection, and to each product bought", async () => {
    const c = await counters([
      {
        type: "purchase",
        query: "tee",
        revenue: 60,
        items: [
          { productId: "gid://shopify/Product/11", qty: 2, revenue: 40 },
          { productId: "12", qty: 1, revenue: 20 },
        ],
      },
      {
        type: "purchase",
        collectionId: "77",
        revenue: 15,
        items: [{ productId: "13", qty: 1, revenue: 15 }],
      },
      { type: "add_to_cart", productId: "11", query: "tee" },
    ]);
    expect(c.queries.get("tee")).toMatchObject({
      revenue: 60,
      productsBought: 3,
      orders: 1,
      addToCarts: 1,
    });
    expect(c.products.get("11")).toMatchObject({ purchases: 2, revenue: 40, addToCarts: 1 });
    expect(c.products.get("13")).toMatchObject({ purchases: 1, revenue: 15 });
    expect(c.collections.get("77")).toMatchObject({ purchases: 1, orders: 1, revenue: 15 });
  });

  it("keeps filter usage per context, value combinations and suggestion clicks", async () => {
    const c = await counters([
      { type: "filter", key: "filter.p.vendor", value: "Nike", scope: "search" },
      { type: "filter", key: "filter.p.vendor", value: "Nike", scope: "77" },
      { type: "filter_combo", scope: "search", values: ["size=M", "vendor=Nike"] },
      { type: "filter_combo", scope: "search", values: ["vendor=Nike", "size=M"] },
      { type: "suggestion", query: "Tee", suggestion: "tee shirt" },
    ]);
    expect(c.usage).toEqual(
      expect.arrayContaining([
        { kind: "FILTER", scope: "search", key: "filter.p.vendor", value: "Nike", count: 1 },
        { kind: "FILTER", scope: "77", key: "filter.p.vendor", value: "Nike", count: 1 },
        { kind: "FILTER_COMBO", scope: "search", key: "size=M&vendor=Nike", value: "", count: 2 },
        { kind: "SUGGESTION", scope: "", key: "tee", value: "tee shirt", count: 1 },
      ]),
    );
  });

  it("drops junk ids, oversized quantities and unknown scopes", async () => {
    const c = await counters([
      { type: "click", productId: "abc", source: "search" },
      { type: "collection_view", collectionId: "../x" },
      { type: "purchase", items: [{ productId: "11", qty: 1e9, revenue: 1e12 }] },
      { type: "filter", key: "k", value: "v", scope: "<script>" },
    ]);
    expect([...c.products.keys()]).toEqual(["11"]);
    expect(c.products.get("11")!.purchases).toBeLessThanOrEqual(1000);
    expect(c.products.get("11")!.revenue).toBeLessThanOrEqual(1_000_000);
    expect(c.collections.size).toBe(0);
    expect(c.usage[0]).toMatchObject({ scope: "" });
  });
});
