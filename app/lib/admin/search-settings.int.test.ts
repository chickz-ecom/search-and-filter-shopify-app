import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp, typesenseUp } from "../../../test/services";
import { defaultSearchSettings } from "../config/search-settings";
import { buildProductSchema } from "../search/index-schema";
import { productAlias, productCollection } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { buildShopContext } from "../search-service/context.server";
import { previewSearch } from "../search-service/preview.server";
import { ensureShop } from "../shop/shop.server";
import { saveSearchSettings } from "./search-settings.server";

const up = (await postgresUp()) && (await typesenseUp());
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

describe.skipIf(!up)("Search page backend (3.2)", () => {
  const domain = `srch-${Date.now()}.myshopify.com`;
  let shop: Awaited<ReturnType<typeof ensureShop>>["shop"];

  beforeAll(async () => {
    shop = (await ensureShop(testDb(), domain)).shop;
    await engine.createCollection(
      buildProductSchema({ name: productCollection(shop.id, 1), locales: [], metafields: [] }),
    );
    await engine.upsertAlias(productAlias(shop.id), productCollection(shop.id, 1));
    await engine.importDocuments(productCollection(shop.id, 1), [
      doc("1", { title: "Zorblax lamp", vendor: "Other" }),
      doc("2", { title: "Plain lamp", vendor: "Zorblax" }),
    ]);
  });

  afterAll(async () => {
    await engine.deleteAlias(productAlias(shop.id));
    await engine.dropCollection(productCollection(shop.id, 1));
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("returns inline errors keyed by path", async () => {
    const s = defaultSearchSettings();
    s.fields[0].weight = 99;
    const r = await saveSearchSettings(testDb(), shop, s, { purge: vi.fn() });
    expect(r).toEqual({ ok: false, errors: { "fields.0.weight": expect.any(String) } });
  });

  it("saves weights without re-index; adding a metafield field queues a full sync", async () => {
    const enqueueFullSync = vi.fn(async () => undefined);
    const purge = vi.fn(async () => undefined);
    const s = defaultSearchSettings();
    s.fields.find((f) => f.key === "vendor")!.weight = 10;
    expect(await saveSearchSettings(testDb(), shop, s, { enqueueFullSync, purge })).toEqual({
      ok: true,
      reindex: false,
    });
    expect(enqueueFullSync).not.toHaveBeenCalled();
    expect(purge).toHaveBeenCalled();
    s.fields.push({
      key: "mf:custom.material",
      enabled: true,
      weight: 3,
      typo: true,
      prefix: false,
    });
    expect(await saveSearchSettings(testDb(), shop, s, { enqueueFullSync, purge })).toEqual({
      ok: true,
      reindex: true,
    });
    expect(enqueueFullSync).toHaveBeenCalledWith(shop.id);
    const saved = await testDb().shop.findUniqueOrThrow({ where: { id: shop.id } });
    expect((saved.onboarding as { search?: string }).search).toBeTruthy();
  });

  it("previews ranking with UNSAVED weights and explains matched fields", async () => {
    const ctx = await buildShopContext(
      testDb(),
      engine,
      await testDb().shop.findUniqueOrThrow({ where: { id: shop.id } }),
    );
    const s = defaultSearchSettings();
    const a = await previewSearch(ctx, s, "zorblax", engine);
    expect(a.hits.map((h) => h.id)).toEqual(["1", "2"]);
    expect(a.hits[0].matched.map((m) => m.key)).toContain("title");
    s.fields.find((f) => f.key === "title")!.weight = 1;
    s.fields.find((f) => f.key === "vendor")!.weight = 10;
    const b = await previewSearch(ctx, s, "zorblax", engine);
    expect(b.hits.map((h) => h.id)).toEqual(["2", "1"]);
    expect(b.hits[0].matched).toEqual([{ key: "vendor", field: "vendor", tokens: ["Zorblax"] }]);
  });
});
