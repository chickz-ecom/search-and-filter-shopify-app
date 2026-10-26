import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { FakeCatalog } from "../../../test/fakes/fake-catalog";
import { instantClock } from "../../../test/fakes/fake-shopify";
import { testRedis } from "../../../test/redis";
import { postgresUp, redisUp, typesenseUp } from "../../../test/services";
import { buildContentSchema, buildProductSchema } from "../search/index-schema";
import { contentAlias, contentCollection, productAlias, productCollection } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { GraphqlExecutor } from "../shopify/graphql";
import { BulkRunner } from "./bulk-runner";
import { runChecksum } from "./checksum.server";
import { importInBatches } from "./pipeline";

const up = (await typesenseUp()) && (await postgresUp()) && (await redisUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
  connectionTimeoutSeconds: 30,
});

const UPDATED = "2026-10-20T00:00:00Z";
const SEC = Math.floor(Date.parse(UPDATED) / 1000);

function minimalDoc(i: number, over: Partial<ProductDoc> = {}): ProductDoc {
  return {
    id: String(i),
    gid: `gid://shopify/Product/${i}`,
    handle: `p-${i}`,
    title: `P ${i}`,
    title_sort: `p ${i}`,
    vendor: "",
    product_type: "",
    tags: [],
    collections: i % 10 === 0 ? ["7"] : [],
    collection_handles: [],
    collection_titles: [],
    description_text: "",
    skus: [],
    barcodes: [],
    variant_titles: [],
    option_values: [],
    price_min: 100,
    price_max: 100,
    discount_pct: 0,
    on_sale: false,
    available: true,
    inventory_total: 1,
    created_at: 1,
    published_at: 1,
    updated_at: SEC,
    variants_json: "[]",
    ...over,
  };
}

describe.skipIf(!up)("nightly checksum (1.9)", () => {
  const shops: string[] = [];
  let shopId = "";
  let catalog: FakeCatalog;
  let deps: Parameters<typeof runChecksum>[1];
  const N = 30_000;

  function serve(n: number, mutate?: (lines: string[]) => void) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const lines = ids.map((i) =>
      JSON.stringify({ id: `gid://shopify/Product/${i}`, updatedAt: UPDATED }),
    );
    mutate?.(lines);
    catalog.fake.data.checksum = lines.join("\n") + "\n";
    const col = [
      JSON.stringify({
        id: "gid://shopify/Collection/7",
        handle: "c7",
        title: "C7",
        sortOrder: "BEST_SELLING",
      }),
    ];
    for (const i of ids)
      if (i % 10 === 0)
        col.push(
          JSON.stringify({
            id: `gid://shopify/Product/${i}`,
            __parentId: "gid://shopify/Collection/7",
          }),
        );
    catalog.fake.data.collections = col.join("\n") + "\n";
  }

  beforeEach(async () => {
    shopId = (
      await ensureShop(
        testDb(),
        `cks-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.myshopify.com`,
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
    catalog.fake.pollsUntilDone = 0;
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
        pollMaxMs: 1,
      }),
    };
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

  it("30k unchanged products: finishes fast and writes nothing to the engine", async () => {
    async function* docs() {
      for (let i = 1; i <= N; i++) yield minimalDoc(i);
    }
    await importInBatches(engine, productCollection(shopId, 1), docs());
    serve(N);
    const importSpy = vi.spyOn(engine, "importDocuments");
    const updateSpy = vi.spyOn(engine, "updateDocuments");
    const deleteSpy = vi.spyOn(engine, "deleteDocuments");
    const enqueueFullSync = vi.fn(async () => undefined);
    const r = await runChecksum(shopId, deps, { enqueueFullSync });
    expect(r.action).toBe("none");
    expect(r.writes).toBe(0);
    expect(r.diff).toMatchObject({
      missing: 0,
      stale: 0,
      extra: 0,
      collections: [],
      shopifyCount: N,
      indexCount: N,
    });
    expect(importSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(enqueueFullSync).not.toHaveBeenCalled();
    expect(r.durationMs).toBeLessThan(120_000);
    console.log(`[bench] checksum 30k unchanged: ${r.durationMs} ms`);
    importSpy.mockRestore();
    updateSpy.mockRestore();
    deleteSpy.mockRestore();
  }, 180_000);

  it("repairs only the drifted IDs and collections; large drift triggers a full sync", async () => {
    await importInBatches(
      engine,
      productCollection(shopId, 1),
      Array.from({ length: 200 }, (_, i) => minimalDoc(i + 1)),
    );
    // Shopify: thêm product 201, product 5 mới hơn, product 200 đã mất; product 3 vào collection 7.
    for (const n of [3, 5, 201]) catalog.upsert(n, { updatedAt: "2026-10-25T00:00:00Z" });
    catalog.collections.set("7", {
      id: "7",
      handle: "c7",
      title: "C7",
      sortOrder: "BEST_SELLING",
      products: [],
    });
    serve(201, (lines) => {
      lines[4] = JSON.stringify({
        id: "gid://shopify/Product/5",
        updatedAt: "2026-10-25T00:00:00Z",
      });
      lines.splice(199, 1);
    });
    catalog.fake.data.collections +=
      JSON.stringify({ id: "gid://shopify/Product/3", __parentId: "gid://shopify/Collection/7" }) +
      "\n";
    catalog.collections.get("7")!.products = Array.from(
      { length: 20 },
      (_, i) => `gid://shopify/Product/${(i + 1) * 10}`,
    )
      .filter((g) => g !== "gid://shopify/Product/200")
      .concat(["gid://shopify/Product/3"]);
    const r = await runChecksum(shopId, deps, { enqueueFullSync: vi.fn(async () => undefined) });
    expect(r.action).toBe("repaired");
    expect(r.diff).toMatchObject({ missing: 1, stale: 1, extra: 1, collections: ["7"] });
    expect(await engine.getDocument(productAlias(shopId), "201")).toBeTruthy();
    expect(await engine.getDocument(productAlias(shopId), "200")).toBeNull();
    expect(
      (await engine.getDocument<ProductDoc>(productAlias(shopId), "3"))?.collections,
    ).toContain("7");

    serve(100);
    const enqueueFullSync = vi.fn(async () => undefined);
    const big = await runChecksum(shopId, deps, { enqueueFullSync });
    expect(big.action).toBe("full-sync");
    expect(enqueueFullSync).toHaveBeenCalledWith(shopId, "checksum-drift");
  });
});
