import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, type FilterItem } from "../../config/filters";
import { defaultSearchSettings } from "../../config/search-settings";
import { DEFAULT_SORT_OPTIONS } from "../../config/sort-options";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "./currency";
import { buildFacets, facetFields } from "./facets";
import {
  buildFilterBy,
  disjunctiveGroups,
  parseFilterParams,
  serializeFilterParams,
  urlParamFor,
} from "./filters";
import { buildSortBy, mainSortTerm, resolveSortKey, type SortContext } from "./sort";
import { buildTextQuery, normalizeQuery, queryKey } from "./text-query";

const ctx = { locale: "en", primaryLocale: "en", indexedLocales: [], mode: "search" as const };

describe("buildTextQuery AI search (5.1)", () => {
  const semantic = { distance: 0.6, alpha: 0.3 };
  it("appends the vector field last with per-field arrays of equal length", () => {
    const q = buildTextQuery(defaultSearchSettings(), { ...ctx, semantic });
    expect(q.queryBy.at(-1)).toBe("embedding");
    expect(q.queryByWeights!.at(-1)).toBe(1);
    expect(q.numTypos!.at(-1)).toBe(0);
    expect(q.prefix!.at(-1)).toBe(false);
    for (const arr of [q.queryByWeights, q.numTypos, q.prefix])
      expect(arr).toHaveLength(q.queryBy.length);
    expect(q.vectorQuery).toBe("embedding:([], alpha: 0.3, distance_threshold: 0.6)");
  });

  it("stays keyword-only for autocomplete, when the index has no vector field, or when off", () => {
    expect(
      buildTextQuery(defaultSearchSettings(), { ...ctx, mode: "suggest", semantic }).vectorQuery,
    ).toBeUndefined();
    const noVec = buildTextQuery(defaultSearchSettings(), {
      ...ctx,
      semantic,
      indexedFields: new Set(["title"]),
    });
    expect(noVec.queryBy).toEqual(["title"]);
    expect(noVec.vectorQuery).toBeUndefined();
    expect(buildTextQuery(defaultSearchSettings(), ctx).queryBy).not.toContain("embedding");
  });
});

describe("buildTextQuery (2.2)", () => {
  it("builds query_by/weights/typos/prefix from enabled fields", () => {
    const q = buildTextQuery(defaultSearchSettings(), ctx);
    expect(q.queryBy).toEqual([
      "title",
      "skus",
      "vendor",
      "product_type",
      "tags",
      "variant_titles",
      "option_values",
      "description_text",
    ]);
    expect(q.queryByWeights).toEqual([127, 114, 76, 76, 64, 51, 51, 25]);
    expect(q.numTypos?.[1]).toBe(0); // SKU không typo
    expect(q.numTypos?.[0]).toBe(2);
    expect(q.prefix?.at(-1)).toBe(false); // description không prefix
  });

  it("changing a weight in config changes the params immediately (no re-index)", () => {
    const s = defaultSearchSettings();
    s.fields.find((f) => f.key === "description")!.weight = 10;
    s.fields.find((f) => f.key === "title")!.weight = 1;
    const q = buildTextQuery(s, ctx);
    expect(q.queryByWeights?.[q.queryBy.indexOf("description_text")]).toBe(127);
    expect(q.queryByWeights?.[q.queryBy.indexOf("title")]).toBe(13);
  });

  it("respects typo tolerance and exactOnly", () => {
    const s = defaultSearchSettings();
    s.typoTolerance = "LOW";
    s.fields.find((f) => f.key === "title")!.exactOnly = true;
    const q = buildTextQuery(s, ctx);
    expect(q.numTypos?.[0]).toBe(0);
    expect(q.prefix?.[0]).toBe(false);
    expect(q.numTypos?.[q.queryBy.indexOf("vendor")]).toBe(1);
    s.typoTolerance = "OFF";
    expect(new Set(buildTextQuery(s, ctx).numTypos)).toEqual(new Set([0]));
  });

  it("adds translated fields first for secondary locales", () => {
    const q = buildTextQuery(defaultSearchSettings(), {
      ...ctx,
      locale: "vi-VN",
      indexedLocales: ["vi"],
    });
    expect(q.queryBy.slice(0, 2)).toEqual(["title_vi", "title"]);
    expect(q.queryBy).toContain("tags_vi");
    expect(q.queryBy).toContain("description_vi");
  });

  it("drops fields that are not in the index and never returns an empty query_by", () => {
    const s = defaultSearchSettings();
    s.fields.push({
      key: "mf:custom.material",
      enabled: true,
      weight: 3,
      typo: true,
      prefix: false,
    });
    const indexed = new Set(["title", "skus"]);
    expect(buildTextQuery(s, { ...ctx, indexedFields: indexed }).queryBy).toEqual([
      "title",
      "skus",
    ]);
    expect(buildTextQuery(s, { ...ctx, indexedFields: new Set() }).queryBy).toEqual(["title"]);
  });

  it("normalizes queries", () => {
    expect(normalizeQuery("  red   dress ")).toBe("red dress");
    expect(queryKey(" Red Dress!! ")).toBe("red dress");
  });
});

describe("sort builder (2.3)", () => {
  const base: SortContext = { hasQuery: true, showOutOfStock: "SHOW", tieBreak: "best_selling" };
  const cases: [string, Partial<SortContext>, string][] = [
    ["relevance", {}, "_text_match:desc,best_selling_rank(missing_values: last):asc"],
    ["relevance", { hasQuery: false }, "best_selling_rank(missing_values: last):asc"],
    ["relevance", { tieBreak: "created_desc" }, "_text_match:desc,published_at:desc"],
    [
      "manual",
      { hasQuery: false, collectionId: "42" },
      "pos_42(missing_values: last):asc,best_selling_rank(missing_values: last):asc",
    ],
    ["manual", { hasQuery: false }, "best_selling_rank(missing_values: last):asc"],
    ["best_selling", {}, "best_selling_rank(missing_values: last):asc,_text_match:desc"],
    ["price_asc", {}, "price_min:asc,_text_match:desc"],
    [
      "price_desc",
      { hasQuery: false },
      "price_min:desc,best_selling_rank(missing_values: last):asc",
    ],
    [
      "price_asc",
      { fixedPriceCountry: "VN" },
      "price_min_vn(missing_values: last):asc,_text_match:desc",
    ],
    ["created_desc", {}, "published_at:desc,_text_match:desc"],
    ["created_asc", {}, "published_at:asc,_text_match:desc"],
    ["title_asc", {}, "title_sort:asc,_text_match:desc"],
    ["title_desc", {}, "title_sort:desc,_text_match:desc"],
    ["discount_desc", {}, "discount_pct:desc,_text_match:desc"],
    ["mf:custom.rating:desc", {}, "mf_custom_rating(missing_values: last):desc,_text_match:desc"],
    [
      "price_asc",
      { showOutOfStock: "PUSH_DOWN" },
      "_eval(available:true):desc,price_min:asc,_text_match:desc",
    ],
    [
      "relevance",
      { showOutOfStock: "PUSH_DOWN" },
      "_eval(available:true):desc,_text_match:desc,best_selling_rank(missing_values: last):asc",
    ],
  ];
  it.each(cases)("%s %o → %s", (key, over, expected) => {
    const sortBy = buildSortBy(key as never, { ...base, ...over });
    expect(sortBy).toBe(expected);
    expect(sortBy.split(",").length).toBeLessThanOrEqual(3);
  });

  it("returns null for unknown keys", () => {
    expect(mainSortTerm("nope" as never, base)).toBeNull();
  });

  it("resolves requested/default sort keys", () => {
    const opts = DEFAULT_SORT_OPTIONS;
    expect(resolveSortKey("price_asc", opts, {}, { hasQuery: true })).toBe("price_asc");
    expect(resolveSortKey("created_asc", opts, {}, { hasQuery: true })).toBe("relevance"); // tắt sẵn
    expect(resolveSortKey(null, opts, {}, { hasQuery: false })).toBe("best_selling");
    expect(resolveSortKey("manual", opts, {}, { hasQuery: true })).toBe("relevance"); // manual chỉ ở collection
    expect(
      resolveSortKey(
        null,
        opts,
        {},
        { hasQuery: false, collectionId: "1", collectionSortOrder: "PRICE_DESC" },
      ),
    ).toBe("price_desc");
    expect(
      resolveSortKey(
        null,
        opts,
        { collections: { "1": "created_desc" } },
        { hasQuery: false, collectionId: "1" },
      ),
    ).toBe("created_desc");
    expect(
      resolveSortKey(
        null,
        opts,
        { collectionDefault: "title_asc" },
        { hasQuery: false, collectionId: "2" },
      ),
    ).toBe("title_asc");
  });
});

const items: FilterItem[] = [
  ...DEFAULT_FILTERS,
  {
    id: "size",
    source: "option",
    optionName: "Size",
    label: { en: "Size" },
    display: "checkbox",
    enabled: true,
    position: 4,
    collapsed: false,
    showCount: true,
    maxValues: 10,
    sortValues: "alpha",
    matchAll: false,
  },
  {
    id: "material",
    source: "metafield",
    metafield: "custom.material",
    label: { en: "Material" },
    display: "checkbox",
    enabled: true,
    position: 5,
    collapsed: true,
    showCount: true,
    maxValues: 10,
    sortValues: "count",
    matchAll: true,
  },
];

describe("filter translator (2.4)", () => {
  it("uses Shopify-native URL params", () => {
    expect(items.map(urlParamFor)).toEqual([
      "filter.v.availability",
      "filter.v.price",
      "filter.p.vendor",
      "filter.p.product_type",
      "filter.v.option.size",
      "filter.p.m.custom.material",
    ]);
  });

  it("parses and serializes round-trip", () => {
    const params = new URLSearchParams(
      "filter.p.vendor=Nike&filter.p.vendor=Adidas&filter.v.price.gte=10&filter.v.price.lte=50.5&filter.v.availability=1&filter.v.option.size=M&unknown=1",
    );
    const applied = parseFilterParams(params, items);
    expect(applied).toEqual({
      vendor: ["Nike", "Adidas"],
      price: { min: 10, max: 50.5 },
      availability: true,
      size: ["M"],
    });
    const back = serializeFilterParams(applied, items);
    expect(parseFilterParams(back, items)).toEqual(applied);
  });

  it("translates to filter_by with escaping and currency minor units", () => {
    const fb = buildFilterBy(
      {
        vendor: ["Nike", "A`B"],
        price: { min: 10, max: 50.5 },
        availability: true,
        material: ["Cotton", "Silk"],
      },
      items,
      { shopCurrency: "USD" },
      ["collections:=`42`"],
    );
    expect(fb).toBe(
      "collections:=`42` && available:=true && (price_min:>=1000 && price_min:<=5050) && vendor:=[`Nike`,`AB`] && (mf_custom_material:=`Cotton` && mf_custom_material:=`Silk`)",
    );
  });

  it("uses zero-decimal currencies and per-market price fields", () => {
    const fb = buildFilterBy({ price: { min: 100000 } }, items, {
      shopCurrency: "USD",
      priceField: "price_min_vn",
      priceCurrency: "VND",
    });
    expect(fb).toBe("price_min_vn:>=100000");
  });

  it("excludes a group for disjunctive facet counts", () => {
    const applied = { vendor: ["Nike"], size: ["M"] };
    expect(disjunctiveGroups(applied, items).map((i) => i.id)).toEqual(["vendor", "size"]);
    expect(buildFilterBy(applied, items, { shopCurrency: "USD" }, [], "vendor")).toBe(
      "opt_size:=[`M`]",
    );
  });

  it("keeps the price slider bounds stable: a range filter gets its own disjunctive query", () => {
    const applied = { price: { max: 60 }, vendor: ["Nike"] };
    expect(disjunctiveGroups(applied, items).map((i) => i.id)).toEqual(["price", "vendor"]);
    expect(buildFilterBy(applied, items, { shopCurrency: "USD" }, [], "price")).not.toContain(
      "price_min",
    );
    expect(disjunctiveGroups({ price: {} }, items)).toEqual([]);
  });
});

describe("facets", () => {
  it("lists facet fields", () => {
    expect(facetFields(items)).toEqual([
      "available",
      "price_min",
      "vendor",
      "product_type",
      "opt_size",
      "mf_custom_material",
    ]);
  });

  it("builds facets with selection, ordering, disjunctive counts and price stats", () => {
    const facets = buildFacets(
      items,
      [
        {
          field: "available",
          values: [
            { value: "true", count: 5 },
            { value: "false", count: 2 },
          ],
        },
        { field: "price_min", values: [], stats: { min: 500, max: 12000 } },
        { field: "vendor", values: [{ value: "Nike", count: 3 }] },
        {
          field: "opt_size",
          values: [
            { value: "S", count: 1 },
            { value: "M", count: 4 },
          ],
        },
      ],
      {
        vendor: [
          {
            field: "vendor",
            values: [
              { value: "Adidas", count: 9 },
              { value: "Nike", count: 3 },
            ],
          },
        ],
      },
      { vendor: ["Nike", "Puma"] },
      { locale: "en", currency: "USD", paramFor: urlParamFor },
    );
    expect(facets.map((f) => f.key)).toEqual(["availability", "price", "vendor", "size"]);
    const vendor = facets.find((f) => f.key === "vendor");
    expect(vendor && "values" in vendor && vendor.values).toEqual([
      { value: "Adidas", count: 9, selected: false, label: undefined },
      { value: "Nike", count: 3, selected: true, label: undefined },
      { value: "Puma", count: 0, selected: true },
    ]);
    const size = facets.find((f) => f.key === "size");
    expect(size && "values" in size && size.values.map((v) => v.value)).toEqual(["M", "S"].sort());
    expect(facets.find((f) => f.key === "price")).toMatchObject({
      type: "range",
      min: 500,
      max: 12000,
      currency: "USD",
    });
    const avail = facets.find((f) => f.key === "availability");
    expect(avail && "values" in avail && avail.values.map((v) => v.value)).toEqual(["true"]);
  });
});

describe("currency", () => {
  it("knows exponents", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("VND")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
    expect(toMinorUnits("19.99", "USD")).toBe(1999);
    expect(fromMinorUnits(1999, "USD")).toBe(19.99);
    expect(toMinorUnits(199000, "VND")).toBe(199000);
  });
});
