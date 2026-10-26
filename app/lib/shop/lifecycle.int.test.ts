import { describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { testRedis } from "../../../test/redis";
import { postgresUp, redisUp, typesenseUp } from "../../../test/services";
import { pendingKey } from "../queue/queue.server";
import { buildContentSchema, buildProductSchema } from "../search/index-schema";
import {
  contentAlias,
  contentCollection,
  curationSetName,
  productAlias,
  productCollection,
  synonymSetName,
} from "../search/names";
import { TypesenseEngine } from "../search/typesense-engine";
import { cleanup, redactShop, uninstallShop } from "./lifecycle.server";
import { ensureShop } from "./shop.server";

const up = (await typesenseUp()) && (await postgresUp()) && (await redisUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

async function seededShop() {
  const domain = `life-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.myshopify.com`;
  const { shop } = await ensureShop(testDb(), domain);
  await engine.upsertSynonymSet(synonymSetName(shop.id), []);
  await engine.upsertCurationSet(curationSetName(shop.id), []);
  await engine.createCollection(
    buildProductSchema({
      name: productCollection(shop.id, 1),
      locales: [],
      metafields: [],
      synonymSets: [synonymSetName(shop.id)],
    }),
  );
  await engine.upsertAlias(productAlias(shop.id), productCollection(shop.id, 1));
  await engine.createCollection(buildContentSchema(contentCollection(shop.id, 1)));
  await engine.upsertAlias(contentAlias(shop.id), contentCollection(shop.id, 1));
  await engine.upsertStopwords(`sw_${shop.id}_en`, ["the"], "en");
  await testDb().session.create({
    data: { id: `s-${shop.id}`, shop: domain, state: "x", accessToken: "t" },
  });
  await testDb().synonym.create({ data: { shopId: shop.id, terms: ["a", "b"] } });
  await testDb().analyticsDaily.create({
    data: { shopId: shop.id, date: new Date("2026-10-25"), query: "x", searches: 3 },
  });
  await testRedis().sadd(pendingKey(shop.id), "1");
  return { shop, domain };
}

describe.skipIf(!up)("uninstall & compliance (1.10)", () => {
  it("uninstall keeps the index (48h) but stops pending work", async () => {
    const { shop } = await seededShop();
    await testDb().syncJob.create({ data: { shopId: shop.id, type: "FULL", status: "RUNNING" } });
    await uninstallShop(shop.id, { db: testDb(), redis: testRedis() });
    expect(await testRedis().exists(pendingKey(shop.id))).toBe(0);
    expect(await engine.getAlias(productAlias(shop.id))).toBe(productCollection(shop.id, 1));
    expect((await testDb().syncJob.findFirstOrThrow({ where: { shopId: shop.id } })).status).toBe(
      "CANCELLED",
    );
    await redactShop(shop.domain, { db: testDb(), engine, redis: testRedis() });
  });

  it("shop/redact deletes the index and every row of the shop", async () => {
    const { shop, domain } = await seededShop();
    const r = await redactShop(domain, { db: testDb(), engine, redis: testRedis() });
    expect(r).toEqual({ shopFound: true, deletedSessions: 1 });
    expect(await engine.getAlias(productAlias(shop.id))).toBeNull();
    expect(await engine.getCollection(productCollection(shop.id, 1))).toBeNull();
    expect(await engine.getCollection(contentCollection(shop.id, 1))).toBeNull();
    expect(await testDb().shop.findUnique({ where: { id: shop.id } })).toBeNull();
    expect(await testDb().synonym.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await testDb().analyticsDaily.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await testDb().sortOption.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await testRedis().exists(pendingKey(shop.id))).toBe(0);
    // Gửi lại (Shopify retry) vẫn 200 / không lỗi.
    expect(await redactShop(domain, { db: testDb(), engine })).toEqual({
      shopFound: false,
      deletedSessions: 0,
    });
  });

  it("cleanup purges old receipts and shops uninstalled > 7 days without redact", async () => {
    const { shop, domain } = await seededShop();
    await testDb().shop.update({
      where: { id: shop.id },
      data: { uninstalledAt: new Date(Date.now() - 8 * 24 * 3600_000) },
    });
    await testDb().webhookReceipt.create({
      data: {
        webhookId: `old-${shop.id}`,
        topic: "x",
        shopDomain: domain,
        receivedAt: new Date(Date.now() - 8 * 24 * 3600_000),
      },
    });
    const r = await cleanup({ db: testDb(), engine, redis: testRedis() });
    expect(r.redacted).toBeGreaterThanOrEqual(1);
    expect(await testDb().shop.findUnique({ where: { id: shop.id } })).toBeNull();
    expect(
      await testDb().webhookReceipt.findUnique({ where: { webhookId: `old-${shop.id}` } }),
    ).toBeNull();
  });

  it("keeps anonymous analytics for 13 months only (privacy policy)", async () => {
    const domain = `ret-${Date.now()}.myshopify.com`;
    const { shop } = await ensureShop(testDb(), domain);
    // Đồng hồ thật: DB test dùng chung, đồng hồ tương lai sẽ xoá dữ liệu của test khác chạy song song.
    const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 3600_000);
    await testDb().analyticsDaily.createMany({
      data: [
        { shopId: shop.id, date: day(401), query: "old", searches: 1 },
        { shopId: shop.id, date: day(10), query: "recent", searches: 1 },
      ],
    });
    await cleanup({ db: testDb(), engine, redis: testRedis() });
    const left = await testDb().analyticsDaily.findMany({ where: { shopId: shop.id } });
    expect(left.map((r) => r.query)).toEqual(["recent"]);
    await testDb().shop.delete({ where: { id: shop.id } });
  });
});
