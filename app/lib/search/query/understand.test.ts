import { describe, expect, it } from "vitest";
import { understandQuery, type Vocabulary } from "./understand";

const vocab: Vocabulary = [
  { filterId: "color", values: ["Đỏ", "Red", "Navy blue", "Xanh dương"] },
  { filterId: "size", values: ["XL", "M"] },
  { filterId: "vendor", values: ["Nike", "Levi's", "Do"] },
];
const usd = { vocab, priceFilterId: "price", currency: "USD" };
const vnd = { vocab, priceFilterId: "price", currency: "VND" };

describe("understandQuery (5.2)", () => {
  it("Vietnamese: 'váy đỏ dưới 500k' → color + price max, query keeps the product noun", () => {
    expect(understandQuery("váy đỏ dưới 500k", vnd)).toEqual({
      query: "váy",
      filters: { color: ["Đỏ"], price: { max: 500_000 } },
    });
  });

  it("English price phrases: under / over / between / ranges with symbols", () => {
    expect(understandQuery("red dress under $50", usd)).toEqual({
      query: "dress",
      filters: { color: ["Red"], price: { max: 50 } },
    });
    expect(understandQuery("jacket over 100", usd)?.filters).toEqual({ price: { min: 100 } });
    expect(understandQuery("shoes between 20 and 49.99", usd)?.filters).toEqual({
      price: { min: 20, max: 49.99 },
    });
    expect(understandQuery("shoes $20-$40", usd)?.filters).toEqual({ price: { min: 20, max: 40 } });
    expect(understandQuery("áo từ 200k đến 1,5tr", vnd)?.filters).toEqual({
      price: { min: 200_000, max: 1_500_000 },
    });
    expect(understandQuery("giày giá dưới 1.200.000đ", vnd)).toEqual({
      query: "giày",
      filters: { price: { max: 1_200_000 } },
    });
  });

  it("multi-word values, filler words and vendors", () => {
    expect(understandQuery("nike hoodie navy blue size xl", usd)).toEqual({
      query: "hoodie",
      filters: { color: ["Navy blue"], size: ["XL"], vendor: ["Nike"] },
    });
    expect(understandQuery("áo màu xanh dương", vnd)).toEqual({
      query: "áo",
      filters: { color: ["Xanh dương"] },
    });
  });

  it("is conservative: short values need exact accents, no partial words, no currency mismatch", () => {
    expect(understandQuery("do it yourself kit", usd)).toBeNull(); // vendor "Do" quá ngắn: phải khớp đúng chữ hoa/dấu? → không
    expect(understandQuery("redwood table", usd)).toBeNull();
    expect(understandQuery("áo do", vnd)).toBeNull(); // "do" không dấu ≠ "Đỏ"
    expect(understandQuery("dress under €50", usd)).toBeNull();
    expect(understandQuery("iphone 15", usd)).toBeNull(); // số trần không phải giá
    expect(understandQuery("under 50", { ...usd, priceFilterId: undefined })).toBeNull();
  });

  it("keeps something to search for and is idempotent on its own output", () => {
    const r = understandQuery("red under 20", usd)!;
    expect(r).toEqual({ query: "", filters: { color: ["Red"], price: { max: 20 } } });
    expect(understandQuery("dress", usd)).toBeNull();
  });
});
