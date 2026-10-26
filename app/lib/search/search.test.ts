import { describe, expect, it } from "vitest";
import {
  buildProductSchema,
  EMBED_FROM,
  metafieldEngineType,
  schemaNeedsReindex,
} from "./index-schema";
import { parseTypesenseNodes, toEngineFieldForTest } from "./typesense-engine";
import { isShopResource, nextVersion, productAlias, productCollection } from "./names";
import { fromTypesenseResult, toTypesenseSearchParams } from "./typesense-engine";

describe("names", () => {
  it("builds per-shop names and versions", () => {
    expect(productAlias("abc123")).toBe("p_abc123");
    expect(productCollection("abc123", 3)).toBe("p_abc123_v3");
    expect(nextVersion("p_abc123_v3")).toBe(4);
    expect(nextVersion(null)).toBe(1);
    expect(() => productAlias("a_b")).toThrow();
    expect(isShopResource("abc", "p_abc_v2")).toBe(true);
    expect(isShopResource("abc", "p_abcd_v2")).toBe(false);
  });
});

describe("index schema", () => {
  it("adds locale and typed metafield fields", () => {
    const s = buildProductSchema({
      name: "p_x_v1",
      locales: ["vi", "pt-BR"],
      metafields: [
        { namespace: "custom", key: "material", type: "single_line_text_field" },
        { namespace: "custom", key: "rating", type: "rating" },
        { namespace: "custom", key: "sizes", type: "list.single_line_text_field" },
      ],
    });
    const byName = Object.fromEntries(s.fields.map((f) => [f.name, f]));
    expect(byName.title_vi.type).toBe("string");
    expect(byName.tags_pt_br.type).toBe("string[]");
    expect(byName.mf_custom_material).toMatchObject({ type: "string", facet: true, sort: false });
    expect(byName.mf_custom_rating).toMatchObject({ type: "float", sort: true });
    expect(byName.mf_custom_sizes.type).toBe("string[]");
    expect(byName["pos_.*"]).toMatchObject({ type: "int32", optional: true });
    expect(byName.gid).toMatchObject({ index: false, optional: true });
  });

  it("maps metafield types", () => {
    expect(metafieldEngineType("number_integer")).toBe("int64");
    expect(metafieldEngineType("boolean")).toBe("bool");
    expect(metafieldEngineType("list.number_decimal")).toBe("float[]");
    expect(metafieldEngineType("color")).toBe("string");
  });

  it("detects schema changes that need a re-index", () => {
    const a = buildProductSchema({ name: "a", locales: [], metafields: [] });
    const b = buildProductSchema({
      name: "b",
      locales: [],
      metafields: [{ namespace: "c", key: "m", type: "boolean" }],
    });
    expect(schemaNeedsReindex(a.fields, a)).toBe(false);
    expect(schemaNeedsReindex(a.fields, b)).toBe(true);
  });
});

describe("typesense param mapping", () => {
  it("serializes per-field arrays and merch params", () => {
    const p = toTypesenseSearchParams({
      q: "",
      queryBy: ["title", "skus"],
      queryByWeights: [127, 114],
      numTypos: [2, 0],
      prefix: [true, true],
      filterBy: "available:=true",
      sortBy: "_text_match:desc",
      pinnedHits: [{ id: "1", position: 1 }],
      hiddenHits: ["2", "3"],
      facetBy: ["vendor", "price_min"],
    });
    expect(p).toMatchObject({
      q: "*",
      query_by: "title,skus",
      query_by_weights: "127,114",
      num_typos: "2,0",
      prefix: "true,true",
      pinned_hits: "1:1",
      hidden_hits: "2,3",
      facet_by: "vendor,price_min",
      highlight_fields: "none",
    });
  });

  it("maps raw results including facet stats", () => {
    const r = fromTypesenseResult<{ id: string }>({
      found: 2,
      hits: [{ document: { id: "1" }, text_match: 10 }],
      facet_counts: [{ field_name: "price_min", counts: [], stats: { min: 100, max: 900 } }],
    });
    expect(r.found).toBe(2);
    expect(r.hits[0].document.id).toBe("1");
    expect(r.facets[0].stats).toMatchObject({ min: 100, max: 900 });
  });
});

describe("AI search schema and params (5.1)", () => {
  it("adds an auto-embedding field only when semantic is on, and re-indexes on toggle", () => {
    const off = buildProductSchema({ name: "p", metafields: [], locales: [] });
    const on = buildProductSchema({
      name: "p",
      metafields: [],
      locales: [],
      semantic: { model: "ts/m" },
    });
    expect(off.fields.some((f) => f.name === "embedding")).toBe(false);
    const emb = on.fields.find((f) => f.name === "embedding")!;
    expect(emb).toEqual({
      name: "embedding",
      type: "float[]",
      embed: { from: EMBED_FROM, model: "ts/m" },
    });
    expect(toEngineFieldForTest(emb)).toEqual({
      name: "embedding",
      type: "float[]",
      embed: { from: EMBED_FROM, model_config: { model_name: "ts/m" } },
    });
    expect(schemaNeedsReindex(off.fields, on)).toBe(true);
    expect(schemaNeedsReindex(on.fields, off)).toBe(true);
    expect(schemaNeedsReindex(on.fields, on)).toBe(false);
  });

  it("maps vector_query and reads vector_distance", () => {
    expect(
      toTypesenseSearchParams({
        q: "x",
        queryBy: ["title"],
        vectorQuery: "embedding:([], alpha: 0.3)",
      }).vector_query,
    ).toBe("embedding:([], alpha: 0.3)");
    const r = fromTypesenseResult<{ id: string }>({
      hits: [{ document: { id: "1" }, vector_distance: 0.4 }],
    });
    expect(r.hits[0].vectorDistance).toBe(0.4);
  });
});

describe("Typesense HA nodes (6.2)", () => {
  it("parses a node list with default ports and rejects other schemes", () => {
    expect(
      parseTypesenseNodes(
        "https://ts1.example.com, http://10.0.0.2:8108 ,https://ts3.example.com:8443",
      ),
    ).toEqual([
      { host: "ts1.example.com", port: 443, protocol: "https" },
      { host: "10.0.0.2", port: 8108, protocol: "http" },
      { host: "ts3.example.com", port: 8443, protocol: "https" },
    ]);
    expect(() => parseTypesenseNodes("ftp://x")).toThrow(/Invalid TYPESENSE_NODES/);
  });
});
