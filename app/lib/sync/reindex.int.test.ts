import { afterAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp, typesenseUp } from "../../../test/services";
import { buildContentSchema, buildProductSchema } from "../search/index-schema";
import { contentAlias, contentCollection, productAlias, productCollection } from "../search/names";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { runReindex } from "./reindex.server";

// Reindex nội bộ: dựng lại index từ document đang có trong engine (không gọi Shopify), swap alias như full sync.
const up = (await postgresUp()) && (await typesenseUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

const doc = (id: string, title: string) => ({
  id,
  gid: `gid://shopify/Product/${id}`,
  handle: title.toLowerCase().replace(/\s+/g, "-"),
  title,
  title_sort: title.toLowerCase(),
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
  created_at: 1,
  published_at: 1,
  updated_at: 1,
  opt_color: ["Red"],
  mf_custom_material: "Wool",
});

describe.skipIf(!up)("runReindex", () => {
  const domain = `reindex-${Date.now()}.myshopify.com`;
  let shopId = "";
  afterAll(async () => {
    if (!shopId) return;
    for (const a of [productAlias(shopId), contentAlias(shopId)])
      await engine.deleteAlias(a).catch(() => undefined);
    for (const v of [1, 2]) {
      await engine.dropCollection(productCollection(shopId, v)).catch(() => undefined);
      await engine.dropCollection(contentCollection(shopId, v)).catch(() => undefined);
    }
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("copies every document into a new version, keeps metafield fields, swaps and drops the old one", async () => {
    const { shop } = await ensureShop(testDb(), domain);
    shopId = shop.id;
    const v1 = productCollection(shopId, 1);
    const schema = buildProductSchema({ name: v1, locales: [], metafields: [] });
    schema.fields.push({ name: "mf_custom_material", type: "string", optional: true, facet: true });
    await engine.createCollection(schema);
    await engine.importDocuments(v1, [
      doc("1", "Wool Hat"),
      doc("2", "Red Scarf"),
      doc("3", "Blue Sock"),
    ]);
    await engine.upsertAlias(productAlias(shopId), v1);
    const c1 = contentCollection(shopId, 1);
    await engine.createCollection(buildContentSchema(c1));
    await engine.importDocuments(c1, [
      {
        id: "collection-9",
        type: "collection",
        title: "Hats",
        handle: "hats",
        url: "/collections/hats",
        body_text: "",
        sort_order: "MANUAL",
        updated_at: 1,
      },
    ]);
    await engine.upsertAlias(contentAlias(shopId), c1);

    const r = await runReindex(shopId, { db: testDb(), engine });

    expect(r).toMatchObject({ status: "SUCCEEDED", expected: 3, imported: 3 });
    const v2 = productCollection(shopId, 2);
    expect(await engine.getAlias(productAlias(shopId))).toBe(v2);
    expect(await engine.getCollection(v1)).toBeNull();
    const moved = await engine.getDocument<{
      title: string;
      mf_custom_material: string;
      opt_color: string[];
    }>(v2, "1");
    expect(moved).toMatchObject({
      title: "Wool Hat",
      mf_custom_material: "Wool",
      opt_color: ["Red"],
    });
    expect(
      (await engine.getCollection(v2))?.fields.some((f) => f.name === "mf_custom_material"),
    ).toBe(true);
    expect(await engine.getAlias(contentAlias(shopId))).toBe(contentCollection(shopId, 2));
    expect(await engine.getDocument(contentCollection(shopId, 2), "collection-9")).toMatchObject({
      handle: "hats",
    });

    const s = await testDb().shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(s).toMatchObject({ syncState: "IDLE", indexVersion: 2, indexedCount: 3 });
    const jobs = await testDb().syncJob.findMany({ where: { shopId } });
    expect(jobs.map((j) => [j.type, j.status])).toEqual([["REINDEX", "SUCCEEDED"]]);
  });

  it("fails cleanly when the shop has no index yet", async () => {
    const { shop } = await ensureShop(testDb(), `none-${domain}`);
    try {
      const r = await runReindex(shop.id, { db: testDb(), engine });
      expect(r.status).toBe("FAILED");
      expect(r.error).toMatch(/Sync from Shopify/);
      const s = await testDb().shop.findUniqueOrThrow({ where: { id: shop.id } });
      expect(s.syncState).toBe("ERROR");
    } finally {
      await testDb().shop.deleteMany({ where: { id: shop.id } });
    }
  });
});
