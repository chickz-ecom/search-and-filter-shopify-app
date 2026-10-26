import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { testRedis } from "../../../test/redis";
import { postgresUp, redisUp, typesenseUp } from "../../../test/services";
import { pushMerchToEngine } from "../../../app/lib/merch/engine-sync.server";
import { EngineUnavailableError, type SearchEngine } from "../../../app/lib/search/engine";
import { buildContentSchema, buildProductSchema } from "../../../app/lib/search/index-schema";
import {
  contentAlias,
  contentCollection,
  curationSetName,
  productAlias,
  productCollection,
  synonymSetName,
} from "../../../app/lib/search/names";
import type { ProductDoc } from "../../../app/lib/search/product-doc";
import { TypesenseEngine } from "../../../app/lib/search/typesense-engine";
import {
  clearContextMemory,
  purgeShopConfig,
} from "../../../app/lib/search-service/context.server";
import { countersKey, dayKey } from "../../../app/lib/search-service/analytics.server";
import { ensureShop } from "../../../app/lib/shop/shop.server";
import { createSearchApi } from "./app";

const up = (await typesenseUp()) && (await postgresUp()) && (await redisUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

function doc(id: string, over: Partial<ProductDoc>): ProductDoc {
  return {
    id,
    gid: `gid://shopify/Product/${id}`,
    handle: `p-${id}`,
    title: `Product ${id}`,
    title_sort: `product ${id}`,
    vendor: "Acme",
    product_type: "Shirts",
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
    created_at: Number(id),
    published_at: Number(id),
    updated_at: 1,
    variants_json: "[]",
    ...over,
  };
}

describe.skipIf(!up)("search-api (2.1)", () => {
  const domain = `api-${Date.now()}.myshopify.com`;
  let shopId = "";
  let key = "";
  let api: ReturnType<typeof createSearchApi>;
  const origin = { Origin: `https://${domain}` };
  const get = (path: string, headers: Record<string, string> = origin) =>
    api.request(path, { headers });
  const qs = (p: Record<string, string>) =>
    new URLSearchParams({ shop: domain, key, ...p }).toString();

  beforeAll(async () => {
    const { shop } = await ensureShop(testDb(), domain, {
      currency: "USD",
      primaryLocale: "en",
      locales: ["en", "vi"],
    });
    shopId = shop.id;
    key = shop.publicKey;
    await testDb().redirect.create({ data: { shopId, query: "shipping", url: "/pages/shipping" } });
    await testDb().synonym.create({ data: { shopId, terms: ["tee", "tshirt"] } });
    await testDb().merchRule.create({
      data: {
        shopId,
        name: "pin cap on summer",
        condition: { collectionId: "77" },
        actions: { pin: [{ productId: "3", position: 1 }] },
      },
    });
    await testDb().filterSet.update({
      where: { shopId_scope_collectionId: { shopId, scope: "DEFAULT", collectionId: "" } },
      data: {
        items: [
          {
            id: "availability",
            source: "availability",
            label: { en: "Availability" },
            display: "toggle",
            enabled: true,
            position: 0,
          },
          {
            id: "price",
            source: "price",
            label: { en: "Price", vi: "Giá" },
            display: "range",
            enabled: true,
            position: 1,
          },
          {
            id: "vendor",
            source: "vendor",
            label: { en: "Brand", vi: "Thương hiệu" },
            display: "checkbox",
            enabled: true,
            position: 2,
          },
          {
            id: "size",
            source: "option",
            optionName: "Size",
            label: { en: "Size" },
            display: "checkbox",
            enabled: true,
            position: 3,
          },
          {
            id: "color",
            source: "option",
            optionName: "Color",
            label: { en: "Color" },
            display: "swatch",
            enabled: true,
            position: 4,
          },
        ],
      },
    });
    await pushMerchToEngine(testDb(), engine, shopId);
    await engine.createCollection(
      buildProductSchema({
        name: productCollection(shopId, 1),
        locales: ["vi"],
        metafields: [],
        synonymSets: [synonymSetName(shopId)],
        curationSets: [curationSetName(shopId)],
      }),
    );
    await engine.upsertAlias(productAlias(shopId), productCollection(shopId, 1));
    await engine.importDocuments(productCollection(shopId, 1), [
      doc("1", {
        title: "Red tshirt",
        vendor: "Nike",
        price_min: 1900,
        price_max: 2400,
        opt_size: ["S", "M"],
        collections: ["77"],
        collection_handles: ["summer"],
        pos_77: 2,
        best_selling_rank: 2,
        on_sale: true,
        discount_pct: 20,
        compare_at_max: 3000,
        title_vi: "Áo thun đỏ",
      }),
      doc("2", {
        title: "Blue jeans",
        vendor: "Levis",
        price_min: 5000,
        price_max: 5000,
        opt_size: ["32"],
        collections: ["77"],
        collection_handles: ["summer"],
        pos_77: 1,
        best_selling_rank: 1,
      }),
      doc("3", {
        title: "Green cap",
        vendor: "Nike",
        price_min: 900,
        price_max: 900,
        available: false,
        collections: ["77"],
        collection_handles: ["summer"],
        pos_77: 3,
      }),
      doc("4", {
        title: "Yellow tshirt",
        vendor: "Adidas",
        price_min: 2100,
        price_max: 2100,
        opt_size: ["L"],
        best_selling_rank: 3,
      }),
    ]);
    await engine.createCollection(buildContentSchema(contentCollection(shopId, 1)));
    await engine.upsertAlias(contentAlias(shopId), contentCollection(shopId, 1));
    await engine.importDocuments(contentCollection(shopId, 1), [
      {
        id: "collection-77",
        type: "collection",
        title: "Summer tshirts",
        handle: "summer",
        url: "/collections/summer",
        body_text: "",
        updated_at: 1,
        sort_order: "MANUAL",
      } as never,
    ]);
    await testRedis().zadd(
      `${process.env.REDIS_PREFIX}:popular:${shopId}`,
      5,
      "tshirt red",
      3,
      "tshirt blue",
    );
    api = createSearchApi({
      db: testDb(),
      redis: testRedis(),
      engineFor: () => engine,
      defaultEngine: engine,
      internalSecret: "s3cret",
      redisPrefix: process.env.REDIS_PREFIX,
    });
  });

  afterAll(async () => {
    for (const p of ["p_", "c_"])
      for (const c of await engine.listCollections(`${p}${shopId}`)) await engine.dropCollection(c);
    await engine.deleteAlias(productAlias(shopId));
    await engine.deleteAlias(contentAlias(shopId));
    await engine.deleteSynonymSet(synonymSetName(shopId));
    await engine.deleteCurationSet(curationSetName(shopId));
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("rejects bad shop / unknown shop / bad key", async () => {
    expect((await get(`/v1/search?shop=evil.com&key=x`)).status).toBe(400);
    expect((await get(`/v1/search?shop=nope-${Date.now()}.myshopify.com&key=x`)).status).toBe(404);
    expect((await get(`/v1/search?${qs({ key: "pk_wrong" })}`)).status).toBe(401);
  });

  it("allows the shop's storefront origin, blocks headless on the free plan, answers preflight", async () => {
    const ok = await get(`/v1/search?${qs({ q: "tshirt" })}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(`https://${domain}`);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=300");
    expect(ok.headers.get("cache-tag")).toBe(`shop-${domain}`);
    expect(
      (await get(`/v1/search?${qs({ q: "tshirt" })}`, { Origin: "https://other.example" })).status,
    ).toBe(403);
    expect((await get(`/v1/search?${qs({ q: "tshirt" })}`, {})).status).toBe(403);
    const pre = await api.request(`/v1/search`, { method: "OPTIONS", headers: origin });
    expect(pre.status).toBe(204);
  });

  it("returns public config with localized sort options, filters and texts", async () => {
    const r = await (await get(`/v1/config?${qs({ locale: "vi" })}`)).json();
    expect(r.sortOptions[0]).toEqual({ key: "relevance", label: "Liên quan" });
    expect(r.filters.default.map((f: { id: string }) => f.id)).toEqual([
      "availability",
      "price",
      "vendor",
      "size",
      "color",
    ]);
    expect(r.filters.default[2]).toMatchObject({ label: "Thương hiệu", param: "filter.p.vendor" });
    expect(r.texts.placeholder).toBe("Tìm sản phẩm");
  });

  it("searches with synonyms, facets (incl. price stats) and base-currency prices", async () => {
    const res = await get(`/v1/search?${qs({ q: "tee" })}`);
    const r = await res.json();
    expect(res.headers.get("x-cache")).toBe("MISS");
    expect(r.total).toBe(2); // "tee" ~ "tshirt" (synonym set)
    expect(r.products.map((p: { id: string }) => p.id).sort()).toEqual(["1", "4"]);
    expect(r.currency).toBe("USD");
    const tee = r.products.find((p: { id: string }) => p.id === "1");
    expect(tee).toMatchObject({
      price_min: 1900,
      compare_at_max: 3000,
      badges: ["sale"],
      url: "/products/p-1",
    });
    const vendor = r.facets.find((f: { key: string }) => f.key === "vendor");
    expect(vendor.values.map((v: { value: string }) => v.value).sort()).toEqual(["Adidas", "Nike"]);
    expect(r.facets.find((f: { key: string }) => f.key === "price")).toMatchObject({
      type: "range",
      min: 1900,
      max: 2100,
    });
    expect(r.facets.some((f: { key: string }) => f.key === "color")).toBe(false); // không sản phẩm nào có Color
    expect(r.sort_options.some((o: { key: string }) => o.key === "manual")).toBe(false);
    expect((await get(`/v1/search?${qs({ q: "tee" })}`)).headers.get("x-cache")).toBe("HIT");
  });

  it("applies native filter params, disjunctive counts and price ranges in major units", async () => {
    const r = await (
      await get(
        `/v1/search?${qs({ q: "", "filter.p.vendor": "Nike", "filter.v.price.gte": "10", "filter.v.price.lte": "20" })}`,
      )
    ).json();
    expect(r.products.map((p: { id: string }) => p.id).sort()).toEqual(["1"]); // 19.00 trong [10, 20]; cap 9.00 bị loại
    const vendor = r.facets.find((f: { key: string }) => f.key === "vendor");
    // Đếm disjunctive: bỏ lựa chọn vendor của chính nhóm, vẫn giữ lọc giá.
    expect(vendor.values.find((v: { value: string }) => v.value === "Nike")).toMatchObject({
      selected: true,
    });
    expect(r.applied_filters).toEqual({ vendor: ["Nike"], price: { min: 10, max: 20 } });
  });

  it("accepts JSON filters, sort, page size and fields; zero results for impossible filters", async () => {
    const r = await (
      await get(
        `/v1/search?${qs({ q: "", filters: JSON.stringify({ size: ["S", "L"] }), sort: "price_desc", per_page: "1", fields: "title,price_min" })}`,
      )
    ).json();
    expect(r.total).toBe(2);
    expect(r.sort).toBe("price_desc");
    expect(r.products).toEqual([
      { id: "4", gid: "gid://shopify/Product/4", title: "Yellow tshirt", price_min: 2100 },
    ]);
    const none = await (
      await get(`/v1/search?${qs({ q: "", filters: JSON.stringify({ color: ["Red"] }) })}`)
    ).json();
    expect(none.total).toBe(0);
  });

  it("pushes sold-out products down by default and returns redirects", async () => {
    const r = await (await get(`/v1/search?${qs({ q: "", sort: "price_asc" })}`)).json();
    expect(r.products.at(-1).id).toBe("3"); // cap rẻ nhất nhưng hết hàng
    const red = await (await get(`/v1/search?${qs({ q: "Shipping!" })}`)).json();
    expect(red.redirect).toBe("/pages/shipping");
  });

  it("searches translated fields for secondary locales", async () => {
    const r = await (await get(`/v1/search?${qs({ q: "áo thun", locale: "vi" })}`)).json();
    expect(r.products[0]?.id).toBe("1");
  });

  it("collection pages: resolve by handle, manual order by default, merch rules via override tags", async () => {
    const r = await (await get(`/v1/collection?${qs({ collection: "summer" })}`)).json();
    expect(r.collection).toEqual({ id: "77", handle: "summer" });
    expect(r.sort).toBe("manual");
    // Rule merch của collection 77 ghim product 3 lên đầu (dù hết hàng).
    expect(r.products.map((p: { id: string }) => p.id)).toEqual(["3", "2", "1"]);
    expect(r.sort_options.some((o: { key: string }) => o.key === "manual")).toBe(true);
    expect((await get(`/v1/collection?${qs({ collection: "nope" })}`)).status).toBe(404);
    const byId = await (
      await get(`/v1/collection?${qs({ collection: "77", sort: "best_selling" })}`)
    ).json();
    expect(byId.sort).toBe("best_selling");
  });

  it("suggests products, collections and popular queries", async () => {
    const r = await (await get(`/v1/suggest?${qs({ q: "tsh" })}`)).json();
    expect(r.products.map((p: { title: string }) => p.title)).toContain("Red tshirt");
    expect(r.collections).toEqual([
      { title: "Summer tshirts", url: "/collections/summer", handle: "summer" },
    ]);
    expect(r.suggestions).toEqual(expect.arrayContaining(["tshirt red", "tshirt blue"]));
  });

  it("records anonymous events and search counters", async () => {
    const res = await api.request(`/v1/events?${qs({})}`, {
      method: "POST",
      headers: { ...origin, "Content-Type": "text/plain" },
      body: JSON.stringify({
        events: [{ type: "click", query: "tee", productId: "1", position: 1 }],
      }),
    });
    expect(res.status).toBe(204);
    const counters = await testRedis().hgetall(countersKey(shopId, dayKey()));
    expect(Number(counters["c|tee"])).toBeGreaterThanOrEqual(1);
    expect(Number(counters["s|tee"])).toBeGreaterThanOrEqual(1);
  });

  it("purges cached config with the internal secret", async () => {
    expect(
      (
        await api.request("/internal/purge", {
          method: "POST",
          body: JSON.stringify({ shop: domain }),
        })
      ).status,
    ).toBe(401);
    const ok = await api.request("/internal/purge", {
      method: "POST",
      headers: { "x-internal-secret": "s3cret" },
      body: JSON.stringify({ shop: domain }),
    });
    expect(ok.status).toBe(200);
  });

  it("returns 503 when the engine is down so the storefront keeps native results", async () => {
    await purgeShopConfig(domain, testRedis());
    clearContextMemory();
    const down = {
      ...engine,
      multiSearch: async () => {
        throw new EngineUnavailableError("down");
      },
      getCollection: async () => null,
    } as unknown as SearchEngine;
    const broken = createSearchApi({
      db: testDb(),
      redis: testRedis(),
      engineFor: () => down,
      defaultEngine: down,
    });
    const res = await broken.request(`/v1/search?${qs({ q: "x" })}`, { headers: origin });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
