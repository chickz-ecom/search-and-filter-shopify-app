import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp, typesenseUp } from "../../../test/services";
import { buildContentSchema, buildProductSchema } from "../search/index-schema";
import { contentAlias, contentCollection, productAlias, productCollection } from "../search/names";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { csvOf, getOverview, getTable, pageRows, type Ctx } from "./reports.server";

const up = (await postgresUp()) && (await typesenseUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});
const range = { from: "2026-10-01", to: "2026-10-03" };
const d = (day: string) => new Date(`${day}T00:00:00Z`);

describe("csv and paging (pure)", () => {
  const table = {
    columns: [
      { key: "query", kind: "text" as const },
      { key: "searches", kind: "number" as const },
      { key: "ctr", kind: "percent" as const },
    ],
    rows: [
      { query: "tee", searches: 5, ctr: 0.4 },
      { query: '=HYPERLINK("x")', searches: 9, ctr: 1 },
      { query: "hat, red", searches: 1, ctr: 0 },
    ],
  };
  it("pages, filters and sorts", () => {
    expect(pageRows(table, {}).rows.map((r) => r.searches)).toEqual([9, 5, 1]);
    expect(pageRows(table, { sort: "query", dir: "asc" }).rows[0].query).toBe('=HYPERLINK("x")');
    expect(pageRows(table, { q: "TE" }).rows.map((r) => r.query)).toEqual(["tee"]);
  });
  it("escapes CSV and neutralises spreadsheet formulas", () => {
    expect(csvOf(table, { query: "Search phrase", searches: "Queries", ctr: "CTR (%)" })).toBe(
      'Search phrase,Queries,CTR (%)\r\ntee,5,40\r\n"\'=HYPERLINK(""x"")",9,100\r\n"hat, red",1,0\r\n',
    );
  });
});

describe.skipIf(!up)("analytics v2 reports", () => {
  const domain = `rep-${Date.now()}.myshopify.com`;
  let ctx: Ctx;

  beforeAll(async () => {
    const { shop } = await ensureShop(testDb(), domain);
    ctx = { db: testDb(), engine, shopId: shop.id, currency: "USD", locale: "en" };
    const p = productCollection(shop.id, 1);
    await engine.createCollection(buildProductSchema({ name: p, locales: [], metafields: [] }));
    const doc = (id: string, title: string, price: number) => ({
      id,
      gid: `gid://shopify/Product/${id}`,
      handle: title.toLowerCase(),
      title,
      title_sort: title.toLowerCase(),
      vendor: "",
      product_type: "",
      tags: [],
      collections: [],
      collection_handles: [],
      collection_titles: [],
      description_text: "",
      skus: [],
      barcodes: [],
      variant_titles: [],
      option_values: [],
      price_min: price,
      price_max: price,
      discount_pct: 0,
      on_sale: false,
      available: true,
      inventory_total: 1,
      created_at: 1,
      published_at: 1,
      updated_at: 1,
      image: `https://cdn.example/${id}.jpg`,
    });
    await engine.importDocuments(p, [doc("1", "Wool Hat", 2000), doc("2", "Red Scarf", 500)]);
    await engine.upsertAlias(productAlias(shop.id), p);
    const c = contentCollection(shop.id, 1);
    await engine.createCollection(buildContentSchema(c));
    await engine.importDocuments(c, [
      {
        id: "collection-9",
        type: "collection",
        title: "Gifts",
        handle: "gifts",
        url: "/collections/gifts",
        body_text: "",
        sort_order: "MANUAL",
        updated_at: 1,
      },
    ]);
    await engine.upsertAlias(contentAlias(shop.id), c);

    const db = testDb();
    const shopId = shop.id;
    await db.analyticsDaily.createMany({
      data: [
        {
          shopId,
          date: d("2026-10-01"),
          query: "hat",
          searches: 10,
          clicks: 4,
          orders: 2,
          productsBought: 3,
          revenueShopCurrency: 60,
        },
        { shopId, date: d("2026-10-02"), query: "hat", searches: 5, clicks: 1 },
        { shopId, date: d("2026-10-02"), query: "zzz", searches: 3, zeroResults: 3 },
        { shopId, date: d("2026-10-03"), query: "", clicks: 7 },
        { shopId, date: d("2026-10-09"), query: "out of range", searches: 99 },
      ],
    });
    await db.analyticsProductDaily.createMany({
      data: [
        {
          shopId,
          date: d("2026-10-01"),
          productId: "1",
          clicks: 4,
          searchClicks: 4,
          purchases: 3,
          revenue: 60,
        },
        {
          shopId,
          date: d("2026-10-03"),
          productId: "2",
          clicks: 7,
          collectionClicks: 7,
          purchases: 1,
          revenue: 5,
        },
      ],
    });
    await db.analyticsCollectionDaily.create({
      data: {
        shopId,
        date: d("2026-10-03"),
        collectionId: "9",
        views: 20,
        clicks: 7,
        purchases: 1,
        orders: 1,
        revenue: 5,
      },
    });
    await db.analyticsUsageDaily.createMany({
      data: [
        {
          shopId,
          date: d("2026-10-01"),
          kind: "FILTER",
          scope: "search",
          key: "vendor",
          value: "Nike",
          count: 4,
        },
        {
          shopId,
          date: d("2026-10-03"),
          kind: "FILTER",
          scope: "9",
          key: "vendor",
          value: "Acme",
          count: 2,
        },
        {
          shopId,
          date: d("2026-10-01"),
          kind: "FILTER_COMBO",
          scope: "search",
          key: "product_type=Hat&vendor=Nike",
          count: 2,
        },
        { shopId, date: d("2026-10-02"), kind: "SUGGESTION", key: "ha", value: "hat", count: 6 },
      ],
    });
  });

  afterAll(async () => {
    if (!ctx) return;
    await engine.deleteAlias(productAlias(ctx.shopId)).catch(() => undefined);
    await engine.deleteAlias(contentAlias(ctx.shopId)).catch(() => undefined);
    await engine.dropCollection(productCollection(ctx.shopId, 1)).catch(() => undefined);
    await engine.dropCollection(contentCollection(ctx.shopId, 1)).catch(() => undefined);
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("overview: totals, a value for every day, and the top lists with names and images", async () => {
    const o = await getOverview(ctx, range);
    expect(o.totals).toEqual({
      clicks: 12,
      searches: 18,
      zeroResults: 3,
      clickedValue: 4 * 20 + 7 * 5, // click × giá hiện tại
      filtersApplied: 6,
      boughtValue: 65,
    });
    expect(o.series.map((s) => s.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(o.series[2].values.clicks).toBe(7);
    expect(o.topQueries[0]).toEqual({ query: "hat", searches: 15 });
    expect(o.topZero).toEqual([{ query: "zzz", count: 3 }]);
    expect(o.topClicked[0]).toMatchObject({
      id: "2",
      title: "Red Scarf",
      image: "https://cdn.example/2.jpg",
      clicks: 7,
    });
    expect(o.topBought[0]).toMatchObject({ title: "Wool Hat", purchases: 3 });
    expect(o.topFilters).toEqual([{ filter: "Brand", count: 6 }]);
    expect(o.topCollections).toEqual([{ id: "9", title: "Gifts", views: 20 }]);
  });

  it("search and collection tables", async () => {
    const q = await getTable(ctx, "search-queries", range);
    expect(q.rows.find((r) => r.query === "hat")).toMatchObject({
      searches: 15,
      productsBought: 3,
      revenue: 60,
      ctr: 5 / 15,
      cr: 2 / 15,
    });
    expect((await getTable(ctx, "search-suggestions", range)).rows).toEqual([
      { query: "ha", suggestion: "hat", clicks: 6 },
    ]);
    expect((await getTable(ctx, "search-filter-combos", range)).rows[0]).toMatchObject({
      combination: "Product type: Hat + Brand: Nike",
      uses: 2,
    });
    expect((await getTable(ctx, "collection-filter-values", range)).rows).toEqual([
      { collection: "Gifts", filter: "Brand", value: "Acme", uses: 2, share: 1 },
    ]);
    expect((await getTable(ctx, "collections", range)).rows).toEqual([
      { collection: "Gifts", views: 20, clicks: 7, purchases: 1, cr: 0.05, revenue: 5 },
    ]);
    const products = await getTable(ctx, "search-products", range);
    expect(products.rows.find((r) => r.productId === "1")).toMatchObject({
      product: "Wool Hat",
      _image: "https://cdn.example/1.jpg",
      searchClicks: 4,
      purchases: 3,
    });
  });
});
