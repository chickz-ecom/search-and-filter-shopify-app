import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { FakeCatalog } from "../../../test/fakes/fake-catalog";
import { instantClock } from "../../../test/fakes/fake-shopify";
import { nestedJsonl } from "../../../test/fakes/fake-nested-bulk";
import { flushTestPrefix, testRedis } from "../../../test/redis";
import { postgresUp, redisUp, typesenseUp } from "../../../test/services";
import { enqueueIncremental } from "../queue/queue.server";
import { buildProductSchema } from "../search/index-schema";
import { productAlias, productCollection } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { GraphqlExecutor } from "../shopify/graphql";
import { BulkRunner } from "./bulk-runner";
import { runDelta } from "./delta.server";
import { fullSyncTargetKey } from "./full-sync.server";
import { runIncrementalJob } from "./incremental-job.server";
import { deleteProducts, inventoryItemsToProducts, refreshProducts } from "./incremental.server";

const up = (await typesenseUp()) && (await postgresUp()) && (await redisUp());
const engine = new TypesenseEngine({
  host: process.env.TYPESENSE_HOST ?? "localhost",
  port: Number(process.env.TYPESENSE_PORT ?? 8108),
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

describe.skipIf(!up)("incremental sync (1.7) + delta (1.9)", () => {
  const shops: string[] = [];
  let shopId = "";
  let catalog: FakeCatalog;
  let deps: Parameters<typeof refreshProducts>[2] & {
    runner: BulkRunner;
    redis: ReturnType<typeof testRedis>;
  };
  const alias = () => productAlias(shopId);
  const get = (id: string) => engine.getDocument<ProductDoc>(alias(), id);

  beforeEach(async () => {
    await flushTestPrefix();
    shopId = (
      await ensureShop(
        testDb(),
        `inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.myshopify.com`,
      )
    ).shop.id;
    shops.push(shopId);
    await engine.createCollection(
      buildProductSchema({ name: productCollection(shopId, 1), locales: [], metafields: [] }),
    );
    await engine.upsertAlias(alias(), productCollection(shopId, 1));
    catalog = new FakeCatalog();
    const clock = instantClock();
    const ex = new GraphqlExecutor(catalog.fake.transport, clock);
    deps = {
      db: testDb(),
      engine,
      ex,
      redis: testRedis(),
      runner: new BulkRunner(ex, {
        fetchImpl: catalog.fake.fetch,
        clock,
        pollMinMs: 1,
        pollMaxMs: 2,
      }),
    };
  });

  afterAll(async () => {
    for (const id of shops) {
      for (const c of await engine.listCollections(`p_${id}`)) await engine.dropCollection(c);
      await engine.deleteAlias(productAlias(id));
      await testDb()
        .shop.delete({ where: { id } })
        .catch(() => undefined);
    }
    await flushTestPrefix();
  });

  it("refreshes changed products, deletes unpublished/removed ones", async () => {
    catalog.upsert(1);
    catalog.upsert(2);
    catalog.upsert(3);
    expect(await refreshProducts(shopId, ["1", "2", "3"], deps)).toEqual({
      upserted: 3,
      deleted: 0,
    });
    catalog.upsert(1, { title: "Renamed" }, "25.00");
    catalog.upsert(2, { onlineStoreUrl: null }); // gỡ khỏi Online Store
    catalog.products.delete("gid://shopify/Product/3"); // xoá hẳn
    expect(await refreshProducts(shopId, ["1", "2", "3"], deps)).toEqual({
      upserted: 1,
      deleted: 2,
    });
    expect(await get("1")).toMatchObject({ title: "Renamed", price_min: 2500 });
    expect(await get("2")).toBeNull();
    expect(await get("3")).toBeNull();
    expect(
      (await testDb().shop.findUniqueOrThrow({ where: { id: shopId } })).lastIncrementalAt,
    ).toBeTruthy();
  });

  it("keeps pos_*, best_selling_rank across refreshes but drops pos_ of collections left", async () => {
    catalog.upsert(5);
    catalog.collections.set("77", {
      id: "77",
      handle: "c",
      title: "C",
      sortOrder: "MANUAL",
      products: ["gid://shopify/Product/5"],
    });
    catalog.collections.set("78", {
      id: "78",
      handle: "d",
      title: "D",
      sortOrder: "MANUAL",
      products: ["gid://shopify/Product/5"],
    });
    await refreshProducts(shopId, ["5"], deps);
    await engine.updateDocuments(alias(), [
      { id: "5", pos_77: 3, pos_78: 1, best_selling_rank: 9 },
    ]);
    catalog.collections.get("78")!.products = [];
    catalog.upsert(5, { title: "Again" });
    await refreshProducts(shopId, ["5"], deps);
    const d = await get("5");
    expect(d).toMatchObject({
      title: "Again",
      pos_77: 3,
      best_selling_rank: 9,
      collections: ["77"],
    });
    expect(d?.pos_78).toBeUndefined();
  });

  it("double-writes into the collection being built by a full sync", async () => {
    const v2 = productCollection(shopId, 2);
    await engine.createCollection(buildProductSchema({ name: v2, locales: [], metafields: [] }));
    await testRedis().set(fullSyncTargetKey(shopId), v2);
    catalog.upsert(9);
    await refreshProducts(shopId, ["9"], deps);
    expect(await engine.getDocument(v2, "9")).toBeTruthy();
    expect(await get("9")).toBeTruthy();
    await deleteProducts(shopId, ["9"], deps);
    expect(await engine.getDocument(v2, "9")).toBeNull();
  });

  it("maps inventory items to products", async () => {
    catalog.upsert(11);
    expect(await inventoryItemsToProducts(deps.ex, ["11", "999"])).toEqual(["11"]);
  });

  it("loses no update under a burst of 1,000 events (phase DoD)", async () => {
    const scheduled: number[] = [];
    const queue = { add: async () => void scheduled.push(1) };
    for (let i = 1; i <= 1000; i++) catalog.upsert(1000 + i);
    // 1.000 webhook dồn dập, có trùng lặp.
    await Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        enqueueIncremental(shopId, [String(1000 + i + 1), String(1000 + ((i * 7) % 1000) + 1)], {
          redis: testRedis(),
          queue,
        }),
      ),
    );
    expect(scheduled).toHaveLength(1); // debounce: một job cho cả loạt
    const t0 = performance.now();
    let r = await runIncrementalJob(
      shopId,
      { ...deps, schedule: async () => undefined },
      { batch: 250 },
    );
    while (r.mode === "batches" && r.remaining > 0)
      r = await runIncrementalJob(shopId, { ...deps, schedule: async () => undefined });
    const ms = performance.now() - t0;
    const col = await engine.getCollection(productCollection(shopId, 1));
    expect(col?.numDocuments).toBe(1000);
    expect(ms).toBeLessThan(60_000);
  });

  it("switches to a delta bulk when more than 2,000 IDs are pending (spike)", async () => {
    for (let i = 1; i <= 2100; i++) catalog.upsert(5000 + i);
    catalog.upsert(5001, { onlineStoreUrl: null });
    catalog.fake.data.products = () =>
      (async function* () {
        yield nestedJsonl(catalog);
      })();
    await testRedis().sadd(
      `${process.env.REDIS_PREFIX}:inc:${shopId}:pending`,
      ...Array.from({ length: 2100 }, (_, i) => String(5000 + i + 1)),
    );
    const r = await runIncrementalJob(shopId, { ...deps, schedule: async () => undefined });
    expect(r.mode).toBe("spike");
    expect((await engine.getCollection(productCollection(shopId, 1)))?.numDocuments).toBe(2099);
    expect(await get("5001")).toBeNull();
  });

  it("delta: paged poll since watermark; nothing changed → no engine writes", async () => {
    catalog.upsert(21);
    await testDb().shop.update({
      where: { id: shopId },
      data: { lastSyncedUpdatedAt: new Date(Date.now() - 60_000) },
    });
    const first = await runDelta(shopId, deps);
    expect(first).toMatchObject({ mode: "paged", upserted: 1 });
    // Watermark tiến tới; lượt sau chỉ lùi 2 phút → product vừa sửa vẫn trong cửa sổ, nên đẩy updatedAt về quá khứ.
    catalog.products.get("gid://shopify/Product/21")!.updatedAt = new Date(
      Date.now() - 10 * 60_000,
    ).toISOString();
    const second = await runDelta(shopId, deps);
    expect(second.mode).toBe("none");
  });
});
