import { afterAll, describe, expect, it, vi } from "vitest";
import { typesenseUp } from "../../../test/services";
import { buildProductSchema } from "../search/index-schema";
import { productAlias, productCollection } from "../search/names";
import { TypesenseEngine } from "../search/typesense-engine";
import { applyBestSellingRanks, currentRanks } from "./best-selling.server";

const up = await typesenseUp();
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});
const shopId = `bs${Date.now().toString(36)}`;

describe.skipIf(!up)("applyBestSellingRanks (1.12)", () => {
  afterAll(async () => {
    await engine.deleteAlias(productAlias(shopId));
    await engine.dropCollection(productCollection(shopId, 1));
  });

  it("writes ranks, then only the changed ones; clears ranks of products that dropped out", async () => {
    await engine.createCollection(
      buildProductSchema({ name: productCollection(shopId, 1), locales: [], metafields: [] }),
    );
    await engine.upsertAlias(productAlias(shopId), productCollection(shopId, 1));
    const base = {
      gid: "g",
      handle: "h",
      title_sort: "t",
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
      price_min: 1,
      price_max: 1,
      discount_pct: 0,
      on_sale: false,
      available: true,
      inventory_total: 1,
      created_at: 1,
      published_at: 1,
      updated_at: 1,
      variants_json: "[]",
    };
    await engine.importDocuments(
      productCollection(shopId, 1),
      ["1", "2", "3"].map((id) => ({ id, title: id, ...base })),
    );

    expect(await applyBestSellingRanks(engine, shopId, ["3", "1", "2"])).toEqual({
      ranked: 3,
      updated: 3,
    });
    const spy = vi.spyOn(engine, "updateDocuments");
    expect(await applyBestSellingRanks(engine, shopId, ["3", "1", "2"])).toEqual({
      ranked: 3,
      updated: 0,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(await applyBestSellingRanks(engine, shopId, ["1", "3"])).toEqual({
      ranked: 2,
      updated: 3,
    });
    const ranks = await currentRanks(engine, productCollection(shopId, 1));
    expect(Object.fromEntries(ranks)).toEqual({ "1": 1, "3": 2 });
    const sorted = await engine.search<{ id: string }>(productAlias(shopId), {
      q: "*",
      queryBy: ["title"],
      sortBy: "best_selling_rank(missing_values: last):asc",
    });
    expect(sorted.hits.map((h) => h.document.id)).toEqual(["1", "3", "2"]);
  });
});
