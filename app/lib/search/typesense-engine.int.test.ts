import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typesenseUp } from "../../../test/services";
import { defaultSearchSettings } from "../config/search-settings";
import { buildProductSchema } from "./index-schema";
import { buildTextQuery } from "./query/text-query";
import { curationSetName, productAlias, productCollection, synonymSetName } from "./names";
import type { ProductDoc } from "./product-doc";
import { TypesenseEngine } from "./typesense-engine";

const up = await typesenseUp();
const shopId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const engine = new TypesenseEngine({
  host: process.env.TYPESENSE_HOST ?? "localhost",
  port: Number(process.env.TYPESENSE_PORT ?? 8108),
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

function doc(id: string, over: Partial<ProductDoc> = {}): ProductDoc {
  return {
    id,
    gid: `gid://shopify/Product/${id}`,
    handle: `p-${id}`,
    title: `Product ${id}`,
    title_sort: `product ${id}`,
    vendor: "Acme",
    product_type: "Shirt",
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
  };
}

describe.skipIf(!up)("TypesenseEngine (live)", () => {
  const v1 = productCollection(shopId, 1);
  const v2 = productCollection(shopId, 2);
  const alias = productAlias(shopId);

  beforeAll(async () => {
    await engine.upsertSynonymSet(synonymSetName(shopId), [
      { id: "s1", synonyms: ["tee", "tshirt"] },
    ]);
    await engine.createCollection(
      buildProductSchema({
        name: v1,
        locales: [],
        metafields: [],
        synonymSets: [synonymSetName(shopId)],
      }),
    );
  });

  afterAll(async () => {
    await engine.deleteAlias(alias);
    await engine.dropCollection(v1);
    await engine.dropCollection(v2);
    await engine.deleteSynonymSet(synonymSetName(shopId));
    await engine.deleteCurationSet(curationSetName(shopId));
  });

  it("imports, searches with weights and dynamic fields", async () => {
    const res = await engine.importDocuments(v1, [
      doc("1", {
        title: "Red tshirt",
        vendor: "Nike",
        skus: ["AB-100"],
        opt_size: ["S", "M"],
        pos_42: 2,
      }),
      doc("2", {
        title: "Blue jeans",
        vendor: "Levis",
        description_text: "pairs with a red tshirt",
        pos_42: 1,
      }),
      doc("3", { title: "Green cap", available: false, price_min: 500, price_max: 500 }),
    ]);
    expect(res).toMatchObject({ success: 3, failed: 0 });
    await engine.upsertAlias(alias, v1);

    const r = await engine.search<ProductDoc>(alias, {
      q: "red",
      queryBy: ["title", "description_text"],
      queryByWeights: [127, 13],
      sortBy: "_text_match:desc",
    });
    expect(r.hits.map((h) => h.document.id)).toEqual(["1", "2"]);

    const sku = await engine.search<ProductDoc>(alias, {
      q: "AB-10",
      queryBy: ["skus"],
      prefix: [true],
    });
    expect(sku.hits[0]?.document.id).toBe("1");

    const manual = await engine.search<ProductDoc>(alias, {
      q: "*",
      queryBy: ["title"],
      filterBy: "collections:=[] || pos_42:>0",
      sortBy: "pos_42:asc",
    });
    expect(manual.hits.map((h) => h.document.id).slice(0, 2)).toEqual(["2", "1"]);

    const facets = await engine.search<ProductDoc>(alias, {
      q: "*",
      queryBy: ["title"],
      facetBy: ["opt_size", "price_min", "available"],
    });
    const price = facets.facets.find((f) => f.field === "price_min");
    expect(price?.stats).toMatchObject({ min: 500, max: 1000 });
    expect(
      facets.facets
        .find((f) => f.field === "opt_size")
        ?.values.map((v) => v.value)
        .sort(),
    ).toEqual(["M", "S"]);
  });

  it("re-ranks immediately when field weights change (no re-index)", async () => {
    const ctx = { locale: "en", primaryLocale: "en", indexedLocales: [], mode: "search" as const };
    const s = defaultSearchSettings();
    const run = async () =>
      (await engine.search<ProductDoc>(alias, { q: "Zorblax", ...buildTextQuery(s, ctx) })).hits.map(
        (h) => h.document.id,
      );
    await engine.importDocuments(v1, [
      doc("w1", { title: "Zorblax runner", vendor: "Other" }),
      doc("w2", { title: "Plain runner", vendor: "Zorblax" }),
    ]);
    expect(await run()).toEqual(["w1", "w2"]);
    s.fields.find((f) => f.key === "title")!.weight = 1;
    s.fields.find((f) => f.key === "vendor")!.weight = 10;
    expect(await run()).toEqual(["w2", "w1"]);
    await engine.deleteDocuments(v1, ["w1", "w2"]);
  });

  it("applies synonym sets", async () => {
    const r = await engine.search<ProductDoc>(alias, { q: "tee", queryBy: ["title"] });
    expect(r.hits.map((h) => h.document.id)).toContain("1");
  });

  it("applies curation sets (pin + hide)", async () => {
    await engine.upsertCurationSet(curationSetName(shopId), [
      {
        id: "c1",
        rule: { query: "red", match: "exact" },
        includes: [{ id: "3", position: 1 }],
        excludes: [{ id: "2" }],
      },
    ]);
    await engine.linkSets(v1, { curationSets: [curationSetName(shopId)] });
    const r = await engine.search<ProductDoc>(alias, {
      q: "red",
      queryBy: ["title", "description_text"],
    });
    expect(r.hits.map((h) => h.document.id)).toEqual(["3", "1"]);
  });

  it("partial updates, deletes and exports", async () => {
    const upd = await engine.updateDocuments(v1, [
      { id: "1", best_selling_rank: 5 },
      { id: "999", best_selling_rank: 1 },
    ]);
    expect(upd.failed).toBe(0);
    expect((await engine.getDocument<ProductDoc>(v1, "1"))?.best_selling_rank).toBe(5);
    expect(await engine.deleteDocuments(v1, ["3"])).toBe(1);
    expect(await engine.getDocument(v1, "3")).toBeNull();
    const rows: { id: string; updated_at: number }[] = [];
    for await (const row of engine.exportDocuments<{ id: string; updated_at: number }>(v1, [
      "id",
      "updated_at",
    ])) {
      rows.push(row);
    }
    expect(rows.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });

  it("swaps alias with zero downtime", async () => {
    await engine.createCollection(buildProductSchema({ name: v2, locales: [], metafields: [] }));
    await engine.importDocuments(v2, [doc("9", { title: "Only in v2" })]);
    await engine.upsertAlias(alias, v2);
    expect(await engine.getAlias(alias)).toBe(v2);
    const r = await engine.search<ProductDoc>(alias, { q: "*", queryBy: ["title"] });
    expect(r.found).toBe(1);
  });

  it("multi-searches across collections", async () => {
    const [a, b] = await engine.multiSearch<ProductDoc>([
      { collection: v1, params: { q: "*", queryBy: ["title"], perPage: 1 } },
      { collection: v2, params: { q: "*", queryBy: ["title"], perPage: 1 } },
    ]);
    expect(a.found).toBe(2);
    expect(b.found).toBe(1);
  });

  it("reports missing resources as null", async () => {
    expect(await engine.getCollection("p_nope_v1")).toBeNull();
    expect(await engine.getAlias("p_nope")).toBeNull();
  });
});
