import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { FakeShopify, instantClock } from "../../../test/fakes/fake-shopify";
import { postgresUp, typesenseUp } from "../../../test/services";
import { contentAlias, productAlias } from "../search/names";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { GraphqlExecutor } from "../shopify/graphql";
import { BulkRunner } from "./bulk-runner";
import { runFullSync } from "./full-sync.server";

const up = (await typesenseUp()) && (await postgresUp());
const fixture = (f: string) =>
  readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8");
const engine = new TypesenseEngine({
  host: process.env.TYPESENSE_HOST ?? "localhost",
  port: Number(process.env.TYPESENSE_PORT ?? 8108),
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

function deps(count = 3) {
  const fake = new FakeShopify({
    products: fixture("products.jsonl"),
    productVariants: fixture("variants.jsonl"),
    collections: fixture("collections.jsonl"),
  });
  fake.handlers.CatalogStats = () => ({
    productsCount: { count, precision: "EXACT" },
    oldest: { nodes: [{ createdAt: "2025-12-01T00:00:00Z" }] },
    newest: { nodes: [{ createdAt: "2026-05-05T00:00:00Z" }] },
  });
  fake.handlers.EarlyProducts = () => ({
    products: {
      nodes: fixture("products.jsonl")
        .split("\n")
        .filter(Boolean)
        .slice(0, 2)
        .map((l) => JSON.parse(l)),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  });
  fake.handlers.ProductMetafieldDefinitions = () => ({
    metafieldDefinitions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  });
  const clock = instantClock();
  const ex = new GraphqlExecutor(fake.transport, clock);
  const runner = new BulkRunner(ex, { fetchImpl: fake.fetch, clock, pollMinMs: 1, pollMaxMs: 2 });
  return { fake, d: { db: testDb(), engine, ex, runner } };
}

describe.skipIf(!up)("runFullSync (1.5, live Postgres + Typesense)", () => {
  const created: string[] = [];
  let shopId = "";

  beforeEach(async () => {
    const { shop } = await ensureShop(
      testDb(),
      `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.myshopify.com`,
    );
    shopId = shop.id;
    created.push(shop.id);
  });

  afterAll(async () => {
    for (const id of created) {
      for (const c of await engine.listCollections(`p_${id}`)) await engine.dropCollection(c);
      for (const c of await engine.listCollections(`c_${id}`)) await engine.dropCollection(c);
      await engine.deleteAlias(productAlias(id));
      await engine.deleteAlias(contentAlias(id));
      await testDb()
        .shop.delete({ where: { id } })
        .catch(() => undefined);
    }
    await testDb().$disconnect();
  });

  it("first sync: points the alias immediately, runs the early pass, indexes everything", async () => {
    const { fake, d } = deps();
    const r = await runFullSync(shopId, d, { reason: "install" });
    expect(r).toMatchObject({
      status: "SUCCEEDED",
      expected: 3,
      staged: 3,
      imported: 3,
      early: 2,
      swapped: false,
    });
    expect(await engine.getAlias(productAlias(shopId))).toBe(`p_${shopId}_v1`);
    const tee = await engine.getDocument<{ skus: string[]; pos_501: number }>(
      `p_${shopId}_v1`,
      "1001",
    );
    expect(tee?.skus).toEqual(["TEE-S-RED", "TEE-M-BLUE"]); // bulk ghi đè bản lượt sớm (chưa có variant)
    expect(tee?.pos_501).toBe(2);
    const content = await engine.search<{ title: string }>(contentAlias(shopId), {
      q: "summer",
      queryBy: ["title"],
    });
    expect(content.hits[0]?.document.title).toBe("Summer");

    const shop = await testDb().shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop).toMatchObject({
      syncState: "IDLE",
      indexVersion: 1,
      productCount: 3,
      indexedCount: 3,
    });
    expect(shop.lastFullSyncAt).toBeTruthy();
    expect(shop.lastSyncedUpdatedAt).toBeTruthy();
    const job = await testDb().syncJob.findFirstOrThrow({ where: { shopId } });
    expect(job.status).toBe("SUCCEEDED");
    // Collection 501 (MANUAL) có 3 thành viên trong bulk → tính vào ngân sách pos_ (task 1.13).
    expect(job.stats).toMatchObject({ manualPositions: 3, posCap: null });
    expect(fake.maxRunning).toBe(3);
  });

  it("re-index builds v2 and swaps the alias with zero downtime, dropping v1", async () => {
    await runFullSync(shopId, deps().d, { reason: "install" });
    const r = await runFullSync(shopId, deps().d, { reason: "schema-change" });
    expect(r).toMatchObject({
      status: "SUCCEEDED",
      swapped: true,
      early: 0,
      collection: `p_${shopId}_v2`,
    });
    expect(await engine.getAlias(productAlias(shopId))).toBe(`p_${shopId}_v2`);
    expect(await engine.getCollection(`p_${shopId}_v1`)).toBeNull();
  });

  it("keeps the old alias and drops the new collection when counts drift > 2%", async () => {
    await runFullSync(shopId, deps().d, { reason: "install" });
    const r = await runFullSync(shopId, deps(50).d, { reason: "reconcile" });
    expect(r.status).toBe("FAILED");
    expect(r.error).toMatch(/Count check failed/);
    expect(await engine.getAlias(productAlias(shopId))).toBe(`p_${shopId}_v1`);
    expect(await engine.getCollection(`p_${shopId}_v2`)).toBeNull();
    const shop = await testDb().shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop.syncState).toBe("ERROR");
  });

  it("works with the Postgres staging backend", async () => {
    const { d } = deps();
    const r = await runFullSync(shopId, { ...d, staging: "pg" }, { reason: "install" });
    expect(r).toMatchObject({ status: "SUCCEEDED", imported: 3 });
  });
});
