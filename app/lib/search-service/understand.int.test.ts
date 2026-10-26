import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp, typesenseUp } from "../../../test/services";
import type { FilterItem } from "../config/filters";
import { buildProductSchema } from "../search/index-schema";
import { productAlias, productCollection } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { buildShopContext } from "./context.server";
import { executeSearch } from "./search.server";

// Task 5.2: hiểu truy vấn chạy với pipeline + Typesense thật (filter mặc định có vendor, size, color).
const up = (await postgresUp()) && (await typesenseUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});
const doc = (id: string, over: Partial<ProductDoc> & Record<string, unknown>): ProductDoc => ({
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

describe.skipIf(!up)("query understanding in the search pipeline (5.2)", () => {
  const domain = `und-${Date.now()}.myshopify.com`;
  let shopId: string;
  const ctx = async (on = true) => {
    const c = await buildShopContext(
      testDb(),
      engine,
      await testDb().shop.findUniqueOrThrow({ where: { id: shopId } }),
    );
    // Merchant đã thêm filter option "Color" (mặc định chỉ có availability/price/vendor/product type).
    const color: FilterItem = {
      id: "color",
      source: "option",
      optionName: "Color",
      label: { en: "Color" },
      display: "swatch",
      enabled: true,
      position: 4,
      collapsed: false,
      showCount: true,
      maxValues: 20,
      sortValues: "count",
      matchAll: false,
    };
    return {
      ...c,
      settings: { ...c.settings, queryUnderstanding: on },
      filters: { ...c.filters, default: [...c.filters.default, color] },
    };
  };
  const search = async (q: string, extra: Record<string, unknown> = {}, on = true) =>
    executeSearch(await ctx(on), { q, locale: "en", filters: {}, ...extra }, engine);

  beforeAll(async () => {
    shopId = (await ensureShop(testDb(), domain)).shop.id;
    const name = productCollection(shopId, 1);
    await engine.createCollection(buildProductSchema({ name, locales: [], metafields: [] }));
    await engine.upsertAlias(productAlias(shopId), name);
    await engine.importDocuments(name, [
      doc("1", { title: "Classic tee", vendor: "Nike", price_min: 1500, opt_color: ["Red"] }),
      doc("2", { title: "Premium tee", vendor: "Nike", price_min: 4500, opt_color: ["Red"] }),
      doc("3", { title: "Classic tee", vendor: "Adidas", price_min: 1200, opt_color: ["Blue"] }),
    ]);
  });
  afterAll(async () => {
    await engine.deleteAlias(productAlias(shopId)).catch(() => undefined);
    await engine.dropCollection(productCollection(shopId, 1)).catch(() => undefined);
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("turns colour and price words into filters and reports the interpretation", async () => {
    const r = await search("red tee under $20");
    expect(r.products.map((p) => p.id)).toEqual(["1"]);
    expect(r.interpreted).toEqual({
      query: "tee",
      original: "red tee under $20",
      filters: { color: ["Red"], price: { max: 20 } },
    });
    expect(r.query).toBe("tee");
  });

  it("keeps the shopper's own filters, respects 'search instead', and is off by default", async () => {
    const own = await search("red tee", { filters: { color: ["Blue"] } });
    expect(own.products.map((p) => p.id)).toEqual(["3"]);
    expect((await search("red tee", { understand: false })).interpreted).toBeUndefined();
    expect((await search("red tee", {}, false)).interpreted).toBeUndefined();
  });

  it("falls back to the literal query when the interpretation finds nothing, and skips foreign-currency prices", async () => {
    const none = await search("red tee under $5");
    expect(none.interpreted).toBeUndefined();
    expect(none.query).toBe("red tee under $5");
    const eur = await search("nike tee under 20", { currency: "EUR" });
    expect(eur.interpreted?.filters).toEqual({ vendor: ["Nike"] });
  });
});
