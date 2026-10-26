import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { testRedis } from "../../../test/redis";
import { postgresUp, redisUp, typesenseUp } from "../../../test/services";
import { mutateMerch } from "../admin/merch.server";
import { buildProductSchema } from "../search/index-schema";
import { productAlias, productCollection } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { buildShopContext } from "../search-service/context.server";
import { ensureShop } from "../shop/shop.server";
import { dismissSuggestion, suggestSynonyms } from "./synonym-suggestions.server";

const up = (await postgresUp()) && (await typesenseUp()) && (await redisUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});
const doc = (id: string, over: Partial<ProductDoc>): ProductDoc => ({
  id,
  gid: `gid://shopify/Product/${id}`,
  handle: `p-${id}`,
  title: "x",
  title_sort: "x",
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
  price_min: 1000,
  price_max: 1000,
  discount_pct: 0,
  on_sale: false,
  available: true,
  inventory_total: 1,
  created_at: 1,
  published_at: 1,
  updated_at: 1,
  variants_json: "[]",
  ...over,
});

describe.skipIf(!up)("synonym suggestions from zero-result searches (5.3)", () => {
  const domain = `syn-${Date.now()}.myshopify.com`;
  let shop: Awaited<ReturnType<typeof ensureShop>>["shop"];
  const now = new Date("2026-10-26T12:00:00Z");
  const ctx = async () =>
    buildShopContext(
      testDb(),
      engine,
      await testDb().shop.findUniqueOrThrow({ where: { id: shop.id } }),
    );

  beforeAll(async () => {
    shop = (await ensureShop(testDb(), domain)).shop;
    const name = productCollection(shop.id, 1);
    await engine.createCollection(buildProductSchema({ name, locales: [], metafields: [] }));
    await engine.upsertAlias(productAlias(shop.id), name);
    await engine.importDocuments(name, [
      doc("1", { title: "Classic cotton tee", product_type: "T-Shirt" }),
      doc("2", { title: "Zip fleece", product_type: "Hoodie" }),
    ]);
    const day = new Date("2026-10-25T00:00:00Z");
    await testDb().analyticsDaily.createMany({
      data: [
        ["tshirt", 5],
        ["hoodies", 3],
        ["lamp", 9],
        ["jumper", 4],
      ].map(([query, n]) => ({
        shopId: shop.id,
        date: day,
        query: String(query),
        searches: Number(n),
        zeroResults: Number(n),
      })),
    });
    // "jumper" đã có synonym → không gợi ý lại.
    await testDb().synonym.create({
      data: { shopId: shop.id, type: "one_way", root: "jumper", terms: ["hoodie"] },
    });
    await testRedis().del(`${process.env.REDIS_PREFIX ?? "sa_test"}:syn-dismissed:${shop.id}`);
  });
  afterAll(async () => {
    await engine.deleteAlias(productAlias(shop.id)).catch(() => undefined);
    await engine.dropCollection(productCollection(shop.id, 1)).catch(() => undefined);
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("proposes catalog terms that actually return products, skipping covered queries", async () => {
    const s = await suggestSynonyms(testDb(), await ctx(), engine, { redis: testRedis(), now });
    expect(s).toEqual([
      { query: "tshirt", searches: 5, term: "T-Shirt", reason: "spacing", products: 1 },
      { query: "hoodies", searches: 3, term: "Hoodie", reason: "plural", products: 1 },
    ]);
  });

  it("approving creates a one-way synonym; dismissing hides the suggestion", async () => {
    const purge = vi.fn(async () => undefined);
    expect(
      await mutateMerch(
        testDb(),
        shop,
        {
          op: "upsert",
          type: "synonyms",
          data: { type: "one_way", root: "tshirt", terms: ["T-Shirt"] },
        },
        { purge },
      ),
    ).toEqual({ ok: true });
    await dismissSuggestion(testRedis(), shop.id, "Hoodies");
    expect(
      await suggestSynonyms(testDb(), await ctx(), engine, { redis: testRedis(), now }),
    ).toEqual([]);
  });
});
