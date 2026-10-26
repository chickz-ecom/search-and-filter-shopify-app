import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { testRedis } from "../../../test/redis";
import { postgresUp, redisUp, typesenseUp } from "../../../test/services";
import { createSearchApi } from "../../../services/search-api/src/app";
import { buildContentSchema, buildProductSchema } from "../search/index-schema";
import { contentAlias, contentCollection, productAlias, productCollection } from "../search/names";
import { TypesenseEngine } from "../search/typesense-engine";
import { purgeShopConfig } from "../search-service/context.server";
import { ensureShop } from "../shop/shop.server";
import { loadSortingForm, saveSorting, sortDataAvailability } from "./sorting.server";

const up = (await postgresUp()) && (await typesenseUp()) && (await redisUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

describe.skipIf(!up)("Sorting page backend (3.3)", () => {
  const domain = `sort-${Date.now()}.myshopify.com`;
  let shop: Awaited<ReturnType<typeof ensureShop>>["shop"];
  // Purge thật (Redis + bộ nhớ process) nhưng không gọi HTTP ra search-api / CDN.
  const purge = vi.fn(async (_db: unknown, s: { domain: string }) =>
    purgeShopConfig(s.domain, testRedis()),
  );

  beforeAll(async () => {
    shop = (await ensureShop(testDb(), domain)).shop;
    await engine.createCollection(
      buildProductSchema({ name: productCollection(shop.id, 1), locales: [], metafields: [] }),
    );
    await engine.upsertAlias(productAlias(shop.id), productCollection(shop.id, 1));
    await engine.createCollection(buildContentSchema(contentCollection(shop.id, 1)));
    await engine.upsertAlias(contentAlias(shop.id), contentCollection(shop.id, 1));
  });
  afterAll(async () => {
    for (const p of ["p_", "c_"])
      for (const c of await engine.listCollections(`${p}${shop.id}`))
        await engine.dropCollection(c);
    await engine.deleteAlias(productAlias(shop.id));
    await engine.deleteAlias(contentAlias(shop.id));
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("validates: duplicate keys, empty labels, disabled defaults", async () => {
    const form = await loadSortingForm(testDb(), shop.id);
    form.options[0] = { ...form.options[0], label: { en: " " } };
    form.defaults.search = "created_asc"; // tắt sẵn
    const r = await saveSorting(testDb(), shop, form, { purge });
    expect(r.ok).toBe(false);
    expect(r.ok === false && Object.keys(r.errors).sort()).toEqual([
      "defaults.search",
      "options.0.label",
    ]);
  });

  it("storefront /config reflects new order, labels and defaults right after saving (DoD ≤ 1 min incl. purge)", async () => {
    const api = createSearchApi({
      db: testDb(),
      redis: testRedis(),
      engineFor: () => engine,
      defaultEngine: engine,
      internalSecret: "s3cret",
    });
    // Như afterConfigSaved ở production: purge Redis + gọi /internal/purge của search-api (micro-cache trong process).
    const purgeWithApi = vi.fn(async (_db: unknown, s: { domain: string }) => {
      await purgeShopConfig(s.domain, testRedis());
      await api.request("/internal/purge", {
        method: "POST",
        headers: { "x-internal-secret": "s3cret" },
        body: JSON.stringify({ shop: s.domain }),
      });
    });
    const cfgUrl = `/v1/config?shop=${domain}&key=${shop.publicKey}&locale=vi`;
    const before = await (
      await api.request(cfgUrl, { headers: { Origin: `https://${domain}` } })
    ).json();
    expect(before.sortOptions[0].key).toBe("relevance");

    const form = await loadSortingForm(testDb(), shop.id);
    const priceDesc = form.options.find((o) => o.key === "price_desc")!;
    priceDesc.label = { en: "Most expensive", vi: "Đắt nhất" };
    form.options = [priceDesc, ...form.options.filter((o) => o.key !== "price_desc")];
    form.options.find((o) => o.key === "title_asc")!.enabled = false;
    form.defaults = { search: "price_desc", collection: "best_selling" };
    form.overrides = [{ collectionId: "77", sortKey: "created_desc" }];
    expect(await saveSorting(testDb(), shop, form, { purge: purgeWithApi })).toEqual({
      ok: true,
      reindex: false,
    });

    const t0 = Date.now();
    const after = await (
      await api.request(cfgUrl, { headers: { Origin: `https://${domain}` } })
    ).json();
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(after.sortOptions[0]).toEqual({ key: "price_desc", label: "Đắt nhất" });
    expect(after.sortOptions.some((o: { key: string }) => o.key === "title_asc")).toBe(false);
    expect(after.sortDefaults.search).toBe("price_desc");
    const reload = await loadSortingForm(testDb(), shop.id);
    expect(reload.overrides).toEqual([{ collectionId: "77", sortKey: "created_desc" }]);
    expect(reload.defaults).toEqual({ search: "price_desc", collection: "best_selling" });
  });

  it("adding a metafield sort queues a re-index; best-selling availability reflects index data", async () => {
    const enqueueFullSync = vi.fn(async () => undefined);
    const form = await loadSortingForm(testDb(), shop.id);
    form.options.push({
      key: "mf:custom.rating:desc",
      label: { en: "Top rated" },
      enabled: true,
      position: form.options.length,
    });
    expect(await saveSorting(testDb(), shop, form, { purge, enqueueFullSync })).toEqual({
      ok: true,
      reindex: true,
    });
    expect(await sortDataAvailability(engine, shop.id)).toEqual({ bestSelling: false });
  });
});
