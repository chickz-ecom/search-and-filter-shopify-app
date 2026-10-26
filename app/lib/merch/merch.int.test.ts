import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp, typesenseUp } from "../../../test/services";
import { buildContentSchema, buildProductSchema } from "../search/index-schema";
import {
  contentAlias,
  contentCollection,
  curationSetName,
  productAlias,
  productCollection,
  stopwordsId,
  synonymSetName,
} from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { buildShopContext } from "../search-service/context.server";
import { executeSearch } from "../search-service/search.server";
import { ensureShop } from "../shop/shop.server";
import { pushMerchToEngine } from "./engine-sync.server";

const up = (await typesenseUp()) && (await postgresUp());
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
  title: `P ${id}`,
  title_sort: `p ${id}`,
  vendor: "Acme",
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
  created_at: Number(id),
  published_at: Number(id),
  updated_at: 1,
  best_selling_rank: Number(id),
  variants_json: "[]",
  ...over,
});

describe.skipIf(!up)("merchandising (2.5)", () => {
  const domain = `merch-${Date.now()}.myshopify.com`;
  let shopId = "";
  const search = async (
    q: string,
    collection?: { id: string; handle: string; sortOrder?: string },
  ) => {
    const shop = await testDb().shop.findUniqueOrThrow({ where: { id: shopId } });
    const ctx = await buildShopContext(testDb(), engine, shop);
    return executeSearch(ctx, { q, locale: "en", filters: {}, collection }, engine);
  };
  const ids = (r: { products: { id?: string }[] }) => r.products.map((p) => p.id);

  beforeAll(async () => {
    shopId = (await ensureShop(testDb(), domain)).shop.id;
    await pushMerchToEngine(testDb(), engine, shopId);
    await engine.createCollection(
      buildProductSchema({
        name: productCollection(shopId, 1),
        locales: [],
        metafields: [],
        synonymSets: [synonymSetName(shopId)],
        curationSets: [curationSetName(shopId)],
      }),
    );
    await engine.upsertAlias(productAlias(shopId), productCollection(shopId, 1));
    await engine.createCollection(buildContentSchema(contentCollection(shopId, 1)));
    await engine.upsertAlias(contentAlias(shopId), contentCollection(shopId, 1));
    await engine.importDocuments(productCollection(shopId, 1), [
      doc("1", { title: "Running shoes", vendor: "Nike", tags: ["old"], collections: ["9"] }),
      doc("2", { title: "Trail running shoes", vendor: "Adidas", collections: ["9"] }),
      doc("3", { title: "Walking shoes", vendor: "Puma", collections: ["9"] }),
      doc("4", { title: "Sneakers", vendor: "Nike", collections: ["9"] }),
      doc("5", { title: "The best socks", vendor: "Acme" }),
    ]);
  });

  afterAll(async () => {
    for (const p of ["p_", "c_"])
      for (const c of await engine.listCollections(`${p}${shopId}`)) await engine.dropCollection(c);
    await engine.deleteAlias(productAlias(shopId));
    await engine.deleteAlias(contentAlias(shopId));
    await engine.deleteSynonymSet(synonymSetName(shopId));
    await engine.deleteCurationSet(curationSetName(shopId));
    await engine.deleteStopwords(stopwordsId(shopId, "en"));
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("one-way synonyms: 'trainers' finds sneakers, not the other way round", async () => {
    await testDb().synonym.create({
      data: { shopId, type: "one_way", root: "trainers", terms: ["sneakers"] },
    });
    await pushMerchToEngine(testDb(), engine, shopId);
    expect(ids(await search("trainers"))).toEqual(["4"]);
    expect(ids(await search("sneakers"))).toEqual(["4"]);
  });

  it("stop words are dropped from the query", async () => {
    // Trước: "the" khớp "The best socks". Sau khi thêm stop word "the": truy vấn rỗng → không khớp gì.
    expect((await search("the")).total).toBe(1);
    await testDb().stopWord.create({ data: { shopId, word: "the", locale: "en" } });
    await pushMerchToEngine(testDb(), engine, shopId);
    expect((await search("the")).total).toBe(0);
    expect((await search("the socks")).total).toBe(1);
  });

  it("query rules pin, hide and boost/bury; schedules respect effective dates", async () => {
    const before = ids(await search("shoes"));
    expect(before).toContain("1");
    await testDb().merchRule.create({
      data: {
        shopId,
        name: "shoes",
        condition: { query: "shoes", match: "exact" },
        actions: {
          pin: [{ productId: "3", position: 1 }],
          hide: ["2"],
          boost: [{ field: "tags", value: "old", weight: -5 }],
        },
      },
    });
    await testDb().merchRule.create({
      data: {
        shopId,
        name: "future",
        condition: { query: "sneakers", match: "exact" },
        actions: { hide: ["4"] },
        startsAt: new Date(Date.now() + 7 * 24 * 3600_000),
      },
    });
    await pushMerchToEngine(testDb(), engine, shopId);
    const after = ids(await search("shoes"));
    expect(after[0]).toBe("3"); // ghim
    expect(after).not.toContain("2"); // ẩn
    expect(after.at(-1)).toBe("1"); // bury theo tag "old"
    expect(ids(await search("sneakers"))).toEqual(["4"]); // rule chưa tới ngày hiệu lực
  });

  it("collection rules apply only on that collection page", async () => {
    await testDb().merchRule.create({
      data: {
        shopId,
        name: "col 9",
        condition: { collectionId: "9" },
        actions: { boost: [{ field: "vendor", value: "Puma", weight: 5 }] },
      },
    });
    await pushMerchToEngine(testDb(), engine, shopId);
    const col = await search("", { id: "9", handle: "c", sortOrder: "BEST_SELLING" });
    expect(ids(col)[0]).toBe("3");
    expect(ids(await search(""))[0]).not.toBe("3");
  });

  it("redirects exact queries", async () => {
    await testDb().redirect.create({ data: { shopId, query: "returns", url: "/pages/returns" } });
    expect((await search("Returns")).redirect).toBe("/pages/returns");
  });
});
