import { describe, expect, it } from "vitest";
import { buildBoostSort, buildCurationItems, buildSynonymItems } from "./engine-sync.server";

describe("merch → engine builders", () => {
  it("builds multi-way and one-way synonyms, dropping invalid rows", () => {
    expect(
      buildSynonymItems([
        { id: "1", type: "multi", root: null, terms: ["Tee", "T-Shirt", "tee "], locale: null },
        { id: "2", type: "one_way", root: "Pants", terms: ["jeans", "trousers"], locale: "en" },
        { id: "3", type: "multi", root: null, terms: ["alone"], locale: null },
      ]),
    ).toEqual([
      { id: "syn_1", synonyms: ["tee", "t-shirt"] },
      { id: "syn_2", root: "pants", synonyms: ["jeans", "trousers"], locale: "en" },
    ]);
  });

  it("builds query and collection curation rules with pin/hide/boost and schedule", () => {
    const items = buildCurationItems([
      {
        id: "a",
        enabled: true,
        condition: { query: "Red Dress", match: "contains" },
        actions: {
          pin: [{ productId: "11", position: 1 }],
          hide: ["12"],
          boost: [{ field: "vendor", value: "Nike", weight: 3 }],
        },
        startsAt: new Date("2026-11-01T00:00:00Z"),
        endsAt: null,
      },
      {
        id: "b",
        enabled: true,
        condition: { collectionId: "501" },
        actions: { boost: [{ field: "tags", value: "old", weight: -5 }] },
        startsAt: null,
        endsAt: null,
      },
      {
        id: "c",
        enabled: false,
        condition: { query: "x" },
        actions: {},
        startsAt: null,
        endsAt: null,
      },
      { id: "d", enabled: true, condition: {}, actions: {}, startsAt: null, endsAt: null },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "rule_a",
      rule: { query: "red dress", match: "contains" },
      includes: [{ id: "11", position: 1 }],
      excludes: [{ id: "12" }],
      sortBy: "_eval([(vendor:=`Nike`):3]):desc,_text_match:desc",
      effectiveFromTs: Date.parse("2026-11-01T00:00:00Z") / 1000,
    });
    expect(items[1]).toMatchObject({
      rule: { tags: ["col_501"] },
      sortBy: "_eval([(tags:=`old`):-5]):desc,best_selling_rank(missing_values: last):asc",
    });
  });

  it("returns no sort override without boosts", () => {
    expect(buildBoostSort([])).toBeUndefined();
  });
});
