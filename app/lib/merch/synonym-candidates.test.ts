import { describe, expect, it } from "vitest";
import { damerau, synonymCandidates } from "./synonym-candidates";

const vocab = ["T-Shirt", "Hoodie", "Sneakers", "Áo thun", "Jacket", "Beanie", "Trousers"];

describe("synonym candidates from zero-result searches (5.3)", () => {
  it("measures edit distance with transpositions as one edit", () => {
    expect(damerau("jakcet", "jacket")).toBe(1);
    expect(damerau("hodie", "hoodie")).toBe(1);
    expect(damerau("abc", "xyz")).toBe(3);
  });

  it("suggests spacing/hyphen variants, plurals and spellings beyond typo tolerance", () => {
    expect(synonymCandidates("tshirt", vocab)).toEqual([{ term: "T-Shirt", reason: "spacing" }]);
    expect(synonymCandidates("hoodies", vocab)).toEqual([{ term: "Hoodie", reason: "plural" }]);
    expect(synonymCandidates("sneaker", vocab)).toEqual([{ term: "Sneakers", reason: "plural" }]);
    expect(synonymCandidates("trowsers", vocab)).toEqual([
      { term: "Trousers", reason: "spelling" },
    ]);
    expect(synonymCandidates("ao thun", vocab)).toEqual([{ term: "Áo thun", reason: "accents" }]);
  });

  it("stays quiet for short or unrelated searches and exact matches", () => {
    expect(synonymCandidates("hat", vocab)).toEqual([]);
    expect(synonymCandidates("lamp", vocab)).toEqual([]);
    expect(synonymCandidates("hoodie", vocab)).toEqual([]);
  });
});
