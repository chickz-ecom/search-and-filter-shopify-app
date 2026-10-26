import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { FakeCatalog } from "../../../test/fakes/fake-catalog";
import { instantClock } from "../../../test/fakes/fake-shopify";
import { flushTestPrefix, testRedis } from "../../../test/redis";
import { postgresUp, redisUp, typesenseUp } from "../../../test/services";
import { buildContentSchema, buildProductSchema } from "../search/index-schema";
import { contentAlias, contentCollection, productAlias, productCollection } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { GraphqlExecutor } from "../shopify/graphql";
import { syncCollection } from "./collections.server";
import { refreshProducts } from "./incremental.server";

const up = (await typesenseUp()) && (await postgresUp()) && (await redisUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

describe.skipIf(!up)("collection changes (1.8)", () => {
  const shops: string[] = [];
  let shopId = "";
  let catalog: FakeCatalog;
  let deps: Parameters<typeof syncCollection>[2];
  const get = (id: string) => engine.getDocument<ProductDoc>(productAlias(shopId), id);
  const gid = (n: number) => `gid://shopify/Product/${n}`;

  beforeEach(async () => {
    await flushTestPrefix();
    shopId = (
      await ensureShop(
        testDb(),
        `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.myshopify.com`,
      )
    ).shop.id;
    shops.push(shopId);
    await engine.createCollection(
      buildProductSchema({ name: productCollection(shopId, 1), locales: [], metafields: [] }),
    );
    await engine.upsertAlias(productAlias(shopId), productCollection(shopId, 1));
    await engine.createCollection(buildContentSchema(contentCollection(shopId, 1)));
    await engine.upsertAlias(contentAlias(shopId), contentCollection(shopId, 1));
    catalog = new FakeCatalog();
    deps = {
      db: testDb(),
      engine,
      ex: new GraphqlExecutor(catalog.fake.transport, instantClock()),
      redis: testRedis(),
    };
    for (const n of [1, 2, 3]) catalog.upsert(n);
    catalog.collections.set("50", {
      id: "50",
      handle: "summer",
      title: "Summer",
      sortOrder: "MANUAL",
      products: [gid(3), gid(1)],
    });
    await refreshProducts(shopId, ["1", "2", "3"], deps);
  });

  afterAll(async () => {
    for (const id of shops) {
      for (const p of ["p_", "c_"])
        for (const c of await engine.listCollections(`${p}${id}`)) await engine.dropCollection(c);
      await engine.deleteAlias(productAlias(id));
      await engine.deleteAlias(contentAlias(id));
      await testDb()
        .shop.delete({ where: { id } })
        .catch(() => undefined);
    }
  });

  it("recomputes manual positions when the order changes (collection.sortOrder / reorder)", async () => {
    await syncCollection(shopId, { collectionId: "50" }, deps);
    expect((await get("3"))?.pos_50).toBe(1);
    expect((await get("1"))?.pos_50).toBe(2);
    catalog.collections.get("50")!.products = [gid(1), gid(3)];
    await syncCollection(shopId, { collectionId: "50", sortOrder: "MANUAL" }, deps);
    expect((await get("1"))?.pos_50).toBe(1);
    expect((await get("3"))?.pos_50).toBe(2);
    const content = await engine.getDocument<{ sort_order: string; handle: string }>(
      contentAlias(shopId),
      "collection-50",
    );
    expect(content).toMatchObject({ sort_order: "MANUAL", handle: "summer" });
  });

  it("product leaving / joining via collection.products updates membership within one job", async () => {
    // Smart collection: đổi tag → product 1 rời, product 2 vào.
    catalog.collections.get("50")!.products = [gid(3), gid(2)];
    const r = await syncCollection(
      shopId,
      { collectionId: "50", added: ["2"], removed: ["1"] },
      deps,
    );
    expect(r).toMatchObject({ mode: "delta", members: 2, removed: 1 });
    const one = await get("1");
    expect(one?.collections).not.toContain("50");
    expect(one?.pos_50).toBeUndefined();
    expect((await get("2"))?.collection_handles).toContain("summer");
  });

  it("switching away from MANUAL clears pos_* (sort then falls back to Shopify's sortOrder)", async () => {
    await syncCollection(shopId, { collectionId: "50" }, deps);
    catalog.collections.get("50")!.sortOrder = "BEST_SELLING";
    await syncCollection(shopId, { collectionId: "50", sortOrder: "BEST_SELLING" }, deps);
    expect((await get("3"))?.pos_50).toBeUndefined();
    expect((await get("3"))?.collections).toContain("50");
  });

  it("deleted collections are removed from every product and the content index", async () => {
    await syncCollection(shopId, { collectionId: "50" }, deps);
    const r = await syncCollection(shopId, { collectionId: "50", deleted: true }, deps);
    expect(r.removed).toBe(2);
    expect((await get("3"))?.collections).toEqual([]);
    expect(await engine.getDocument(contentAlias(shopId), "collection-50")).toBeNull();
  });

  it("the products/update path alone keeps smart-collection membership right (fallback when no event fires)", async () => {
    catalog.collections.get("50")!.products = [gid(3)];
    await refreshProducts(shopId, ["1"], deps);
    expect((await get("1"))?.collections).toEqual([]);
  });
});
