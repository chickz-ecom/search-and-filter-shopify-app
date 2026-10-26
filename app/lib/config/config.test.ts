import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_FIELDS,
  DEFAULT_SORT_OPTIONS,
  FilterItemSchema,
  FilterItemsSchema,
  SearchSettingsSchema,
  defaultSearchSettings,
  docFieldForSearchKey,
  facetFieldFor,
  labelFor,
  metafieldDocField,
  normalizeSearchFields,
  optionDocField,
  sortKeyFromCollectionSortOrder,
  visibleSortOptions,
  weightToEngine,
} from "./index";

describe("search fields", () => {
  it("matches the default table in plan 4.3", () => {
    const byKey = Object.fromEntries(DEFAULT_SEARCH_FIELDS.map((f) => [f.key, f]));
    expect(byKey.title).toMatchObject({ enabled: true, weight: 10, typo: true, prefix: true });
    expect(byKey.sku).toMatchObject({ enabled: true, weight: 9, typo: false, prefix: true });
    expect(byKey.description).toMatchObject({ enabled: true, weight: 2, prefix: false });
    expect(byKey.barcode).toMatchObject({ enabled: false, weight: 8, typo: false, prefix: false });
    expect(byKey.collection_titles).toMatchObject({ enabled: false, weight: 3 });
  });

  it("maps UI weights 1–10 onto 0–127", () => {
    expect(weightToEngine(10)).toBe(127);
    expect(weightToEngine(1)).toBe(13);
    expect(weightToEngine(5)).toBe(64);
    expect(weightToEngine(99)).toBe(127);
    expect(weightToEngine(0)).toBe(13);
  });

  it("maps keys to document fields", () => {
    expect(docFieldForSearchKey("sku")).toBe("skus");
    expect(docFieldForSearchKey("description")).toBe("description_text");
    expect(docFieldForSearchKey("options")).toBe("option_values");
    expect(docFieldForSearchKey("mf:custom.material")).toBe("mf_custom_material");
    expect(metafieldDocField("my-app", "fit.type")).toBe("mf_my_app_fit_type");
  });

  it("normalizes saved config, keeping order and adding missing builtins", () => {
    const out = normalizeSearchFields([
      { key: "sku", enabled: true, weight: 10, typo: false, prefix: true },
    ]);
    expect(out[0].key).toBe("sku");
    expect(out).toHaveLength(DEFAULT_SEARCH_FIELDS.length);
  });
});

describe("search settings schema", () => {
  it("accepts defaults", () => {
    expect(SearchSettingsSchema.safeParse(defaultSearchSettings()).success).toBe(true);
  });

  it("rejects duplicate fields, all-disabled and bad typo lengths", () => {
    const s = defaultSearchSettings();
    const dup = { ...s, fields: [...s.fields, s.fields[0]] };
    expect(SearchSettingsSchema.safeParse(dup).success).toBe(false);
    const none = { ...s, fields: s.fields.map((f) => ({ ...f, enabled: false })) };
    expect(SearchSettingsSchema.safeParse(none).success).toBe(false);
    const typo = { ...s, minWordLengthFor1Typo: 8, minWordLengthFor2Typo: 4 };
    const r = SearchSettingsSchema.safeParse(typo);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["minWordLengthFor2Typo"]);
  });

  it("rejects weights out of range and bad metafield keys", () => {
    const s = defaultSearchSettings();
    s.fields[0].weight = 11;
    expect(SearchSettingsSchema.safeParse(s).success).toBe(false);
    const t = defaultSearchSettings();
    t.fields.push({
      key: "mf:bad" as `mf:${string}.${string}`,
      enabled: true,
      weight: 3,
      typo: true,
      prefix: false,
    });
    expect(SearchSettingsSchema.safeParse(t).success).toBe(false);
  });
});

describe("sort options", () => {
  it("filters by context and orders by position", () => {
    const search = visibleSortOptions(DEFAULT_SORT_OPTIONS, {
      hasQuery: true,
      isCollection: false,
    });
    expect(search.map((o) => o.key)).not.toContain("manual");
    expect(search[0].key).toBe("relevance");
    const collection = visibleSortOptions(DEFAULT_SORT_OPTIONS, {
      hasQuery: false,
      isCollection: true,
    });
    expect(collection.map((o) => o.key)).not.toContain("relevance");
    expect(collection[0].key).toBe("manual");
  });

  it("resolves labels by locale with fallbacks", () => {
    expect(labelFor({ en: "Newest", vi: "Mới nhất" }, "vi-VN", "x")).toBe("Mới nhất");
    expect(labelFor({ en: "Newest" }, "fr", "x")).toBe("Newest");
    expect(labelFor({}, "fr", "created_desc")).toBe("created_desc");
  });

  it("maps collection sort orders", () => {
    expect(sortKeyFromCollectionSortOrder("BEST_SELLING")).toBe("best_selling");
    expect(sortKeyFromCollectionSortOrder("PRICE_DESC")).toBe("price_desc");
    expect(sortKeyFromCollectionSortOrder("MANUAL")).toBe("manual");
    expect(sortKeyFromCollectionSortOrder(undefined)).toBe("manual");
  });
});

describe("filters", () => {
  const base = { id: "x", label: { en: "X" }, position: 0 };
  it("validates per-source requirements", () => {
    expect(
      FilterItemSchema.safeParse({ ...base, source: "option", display: "checkbox" }).success,
    ).toBe(false);
    expect(
      FilterItemSchema.safeParse({ ...base, source: "price", display: "checkbox" }).success,
    ).toBe(false);
    expect(
      FilterItemSchema.safeParse({
        ...base,
        source: "option",
        optionName: "Size",
        display: "checkbox",
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const item = { ...base, source: "vendor", display: "checkbox" };
    expect(FilterItemsSchema.safeParse([item, item]).success).toBe(false);
  });

  it("maps to facet fields", () => {
    expect(facetFieldFor({ source: "option", optionName: "Màu sắc" })).toBe("opt_mau_sac");
    expect(facetFieldFor({ source: "metafield", metafield: "custom.material" })).toBe(
      "mf_custom_material",
    );
    expect(facetFieldFor({ source: "collection" })).toBe("collections");
    expect(optionDocField("Size")).toBe("opt_size");
    expect(optionDocField("Đường kính")).toBe("opt_duong_kinh");
  });
});
