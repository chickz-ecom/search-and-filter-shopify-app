import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  gidToId,
  mapProduct,
  parseMetafieldValue,
  stripHtml,
  type CollectionMembership,
  type ProductNode,
  type VariantNode,
} from "./mapper";

const read = <T>(f: string): T[] =>
  readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);

const products = read<ProductNode>("products.jsonl");
const variants = read<VariantNode>("variants.jsonl");
const byProduct = (id: string) => variants.filter((v) => v.product.id === id);

const metafields = [
  { namespace: "custom", key: "material", type: "single_line_text_field" },
  { namespace: "custom", key: "rating", type: "rating" },
  { namespace: "custom", key: "fit", type: "list.single_line_text_field" },
  { namespace: "custom", key: "weight", type: "number_integer" },
];

const collections: CollectionMembership[] = [
  { id: "501", handle: "summer", title: "Summer", position: 2, manual: true },
  { id: "502", handle: "all", title: "All products", position: 1, manual: false },
];

describe("mapProduct (1.4)", () => {
  const tee = mapProduct(products[0], byProduct(products[0].id), {
    currency: "USD",
    metafields,
    collections,
    bestSellingRank: 3,
  });

  it("maps identity, text and sort fields", () => {
    expect(tee).toMatchObject({
      id: "1001",
      gid: "gid://shopify/Product/1001",
      handle: "classic-tee",
      title: "Classic Tee",
      title_sort: "classic tee",
      vendor: "Acme",
      product_type: "Shirts",
      tags: ["cotton", "summer"],
      description_text: "A soft cotton tee. Machine washable.",
      image: "https://cdn.shopify.com/s/files/tee.jpg",
      image_alt: "Front of tee",
      best_selling_rank: 3,
    });
    expect(tee.created_at).toBe(Date.parse("2026-01-10T10:00:00Z") / 1000);
    expect(tee.published_at).toBe(Date.parse("2026-01-11T10:00:00Z") / 1000);
  });

  it("aggregates variants into price range (minor units), skus, options and availability", () => {
    expect(tee).toMatchObject({
      price_min: 1900,
      price_max: 2400,
      compare_at_max: 3000,
      discount_pct: 37,
      on_sale: true,
      available: true,
      inventory_total: 12,
      skus: ["TEE-S-RED", "TEE-M-BLUE"],
      barcodes: ["0001"],
      variant_titles: ["S / Red", "M / Blue"],
      opt_size: ["S", "M", "L"],
      opt_color: ["Red", "Blue"],
    });
    expect(tee.option_values).toEqual(["S", "M", "L", "Red", "Blue"]);
    const vs = JSON.parse(tee.variants_json);
    expect(vs[0]).toEqual({
      id: "2001",
      title: "S / Red",
      sku: "TEE-S-RED",
      price: 1900,
      compare_at: 3000,
      available: true,
      options: ["S", "Red"],
    });
  });

  it("maps collections and manual positions", () => {
    expect(tee.collections).toEqual(["501", "502"]);
    expect(tee.collection_handles).toEqual(["summer", "all"]);
    expect(tee.collection_titles).toEqual(["Summer", "All products"]);
    expect(tee.pos_501).toBe(2);
    expect(tee.pos_502).toBeUndefined(); // không phải MANUAL → không lưu pos
  });

  it("parses typed metafields", () => {
    expect(tee.mf_custom_material).toBe("Cotton");
    expect(tee.mf_custom_rating).toBe(4.5);
    expect(tee.mf_custom_fit).toEqual(["Crew", "Regular"]);
    expect(tee.mf_custom_weight).toBeUndefined();
  });

  it("handles default variants, missing images and unpublished dates", () => {
    const gift = mapProduct(products[1], byProduct(products[1].id), {
      currency: "USD",
      metafields,
    });
    expect(gift.variant_titles).toEqual([]);
    expect(gift.option_values).toEqual([]);
    expect(gift.opt_title).toBeUndefined();
    expect(gift.image).toBeUndefined();
    expect(gift.on_sale).toBe(false); // compareAt == price
    expect(gift.compare_at_max).toBeUndefined();
    expect(gift.published_at).toBe(gift.created_at);
    expect(gift.mf_custom_weight).toBe(42);
    expect(gift.collections).toEqual([]);
  });

  it("handles out-of-stock, negative inventory and HTML-ish titles", () => {
    const jeans = mapProduct(products[2], byProduct(products[2].id), {
      currency: "USD",
      metafields: [],
    });
    expect(jeans).toMatchObject({
      available: false,
      inventory_total: 0,
      discount_pct: 50,
      on_sale: true,
      skus: ["JEANS-32"],
      title_sort: "arger jeans <slim>",
    });
  });

  it("falls back to priceRangeV2 when variants are missing (early results pass)", () => {
    const d = mapProduct(products[0], [], { currency: "USD", metafields: [] });
    expect(d).toMatchObject({
      price_min: 1900,
      price_max: 2400,
      compare_at_max: 3000,
      available: true,
    });
  });

  it("supports zero-decimal currencies", () => {
    const v = byProduct(products[0].id).map((x) => ({
      ...x,
      price: "199000",
      compareAtPrice: null,
    }));
    const d = mapProduct(products[0], v, { currency: "VND", metafields: [] });
    expect(d.price_min).toBe(199000);
  });

  it("adds translations and fixed market prices", () => {
    const d = mapProduct(products[0], byProduct(products[0].id), {
      currency: "USD",
      metafields: [],
      translations: {
        vi: { title: "Áo thun", description: "<p>Áo <b>cotton</b></p>", tags: ["mùa hè"] },
      },
      marketPrices: { VN: 450000 },
    });
    expect(d.title_vi).toBe("Áo thun");
    expect(d.description_vi).toBe("Áo cotton");
    expect(d.tags_vi).toEqual(["mùa hè"]);
    expect(d.price_min_vn).toBe(450000);
  });
});

describe("helpers", () => {
  it("parses gids", () => {
    expect(gidToId("gid://shopify/Product/123")).toBe("123");
    expect(gidToId("gid://shopify/ProductVariant/9?x=1")).toBe("9");
  });

  it("strips html and truncates", () => {
    expect(stripHtml("<p>Hi&nbsp;<b>there</b> &amp; you</p><script>x()</script>")).toBe(
      "Hi there & you",
    );
    expect(stripHtml("a".repeat(3000)).length).toBe(2000);
  });

  it("parses metafield values by type", () => {
    expect(parseMetafieldValue("true", "boolean")).toBe(true);
    expect(parseMetafieldValue("3.25", "number_decimal")).toBe(3.25);
    expect(parseMetafieldValue("2026-10-26", "date")).toBe(Date.parse("2026-10-26") / 1000);
    expect(parseMetafieldValue("[1,2]", "list.number_integer")).toEqual([1, 2]);
    expect(parseMetafieldValue('{"amount":"5.00","currency_code":"USD"}', "money")).toBe(5);
    expect(parseMetafieldValue("not json", "list.single_line_text_field")).toEqual(["not json"]);
    expect(parseMetafieldValue("abc", "number_integer")).toBeUndefined();
  });
});

describe("pos cap (1.13)", () => {
  it("drops positions beyond the cap when the shop is over the pos_ budget", async () => {
    const { computePosCap } = await import("./pipeline");
    expect(computePosCap([500_000, 400_000])).toBeUndefined();
    expect(computePosCap([900_000, 200_000])).toBe(250);
    const d = mapProduct(products[0], [], {
      currency: "USD",
      metafields: [],
      collections: [
        { id: "1", handle: "a", title: "A", manual: true, position: 10 },
        { id: "2", handle: "b", title: "B", manual: true, position: 900 },
      ],
      posCap: 250,
    });
    expect(d.pos_1).toBe(10);
    expect(d.pos_2).toBeUndefined();
    expect(d.collections).toEqual(["1", "2"]);
  });
});
