import { createHmac } from "node:crypto";
import { Worker } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import {
  bullPrefix,
  closeQueues,
  queueConnection,
  SYNC_QUEUE,
  type SyncJobData,
} from "../app/lib/queue/queue.server";
import { buildProductSchema } from "../app/lib/search/index-schema";
import { productAlias, productCollection } from "../app/lib/search/names";
import { TypesenseEngine } from "../app/lib/search/typesense-engine";
import { ensureShop } from "../app/lib/shop/shop.server";
import { GraphqlExecutor } from "../app/lib/shopify/graphql";
import { BulkRunner } from "../app/lib/sync/bulk-runner";
import { runIncrementalJob } from "../app/lib/sync/incremental-job.server";
import { handleWebhookRequest } from "../app/lib/webhooks/dispatch.server";
import { testDb } from "./db";
import { FakeCatalog } from "./fakes/fake-catalog";
import { testRedis } from "./redis";
import { postgresUp, redisUp, typesenseUp } from "./services";

// DoD Phase 1: sửa sản phẩm → search đổi sau ≤ 60 giây. Đường thật: webhook (HMAC) → dedupe → BullMQ (debounce 3s)
// → worker → nodes(ids:) (Shopify giả) → Typesense → search thấy thay đổi.
const up = (await typesenseUp()) && (await postgresUp()) && (await redisUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});
const SECRET = process.env.SHOPIFY_API_SECRET ?? "shpss_fake_secret_for_local_dev";

describe.skipIf(!up)("end-to-end sync latency (Phase 1 DoD)", () => {
  let worker: Worker<SyncJobData> | undefined;
  const domain = `lat-${Date.now()}.myshopify.com`;
  let shopId = "";

  afterAll(async () => {
    await worker?.close();
    await closeQueues();
    await engine.deleteAlias(productAlias(shopId));
    for (const c of await engine.listCollections(`p_${shopId}`)) await engine.dropCollection(c);
    await testDb().webhookReceipt.deleteMany({ where: { shopDomain: domain } });
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("a product edit is searchable well within 60s, and a 1,000-event burst loses nothing", async () => {
    shopId = (await ensureShop(testDb(), domain)).shop.id;
    await engine.createCollection(
      buildProductSchema({ name: productCollection(shopId, 1), locales: [], metafields: [] }),
    );
    await engine.upsertAlias(productAlias(shopId), productCollection(shopId, 1));
    const catalog = new FakeCatalog();
    const ex = new GraphqlExecutor(catalog.fake.transport);
    const deps = {
      db: testDb(),
      engine,
      ex,
      redis: testRedis(),
      runner: new BulkRunner(ex, { fetchImpl: catalog.fake.fetch }),
    };
    const schedule = async (sid: string, delay: number) => {
      const { getSyncQueue, scheduledKey, INCREMENTAL_DEBOUNCE_MS } =
        await import("../app/lib/queue/queue.server");
      if (await testRedis().set(scheduledKey(sid), "1", "PX", INCREMENTAL_DEBOUNCE_MS * 10, "NX")) {
        await getSyncQueue().add(
          "incremental",
          { type: "incremental", shopId: sid },
          { delay, jobId: `inc-${sid}-${Date.now()}` },
        );
      }
    };
    worker = new Worker<SyncJobData>(
      SYNC_QUEUE,
      async (job) =>
        job.data.type === "incremental"
          ? runIncrementalJob(job.data.shopId, { ...deps, schedule })
          : null,
      { connection: queueConnection(), prefix: bullPrefix(), concurrency: 4 },
    );

    const send = (id: number, webhookId: string) => {
      const body = JSON.stringify({ id, updated_at: new Date().toISOString() });
      return handleWebhookRequest(
        new Request("https://app/webhooks/products", {
          method: "POST",
          body,
          headers: {
            "X-Shopify-Hmac-Sha256": createHmac("sha256", SECRET).update(body).digest("base64"),
            "X-Shopify-Topic": "products/update",
            "X-Shopify-Shop-Domain": domain,
            "X-Shopify-Webhook-Id": webhookId,
          },
        }),
        { db: testDb(), secret: SECRET },
      );
    };
    const waitFor = async (pred: () => Promise<boolean>, timeoutMs: number) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (await pred()) return Date.now() - t0;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("timeout");
    };

    // 1) Một lần sửa.
    catalog.upsert(1, { title: "Zebra lamp" });
    const t0 = Date.now();
    expect((await send(1, `lat-1-${t0}`)).status).toBe(200);
    await waitFor(
      async () =>
        (await engine.search(productAlias(shopId), { q: "zebra", queryBy: ["title"] })).found === 1,
      60_000,
    );
    const latency = Date.now() - t0;
    console.log(`[bench] webhook → searchable: ${latency} ms (debounce 3000 ms)`);
    expect(latency).toBeLessThan(60_000);

    // 2) 1.000 webhook dồn dập (có trùng webhookId) → đủ 1.000 doc.
    for (let i = 2; i <= 1001; i++) catalog.upsert(i);
    const t1 = Date.now();
    await Promise.all(
      Array.from({ length: 1000 }, (_, k) => send(k + 2, `burst-${k % 990}-${t1}`)),
    );
    // 10 webhook trùng id bị dedupe → các product đó được gửi lại bằng id khác.
    await Promise.all(
      Array.from({ length: 10 }, (_, k) => send(992 + k, `burst-retry-${k}-${t1}`)),
    );
    const burstMs = await waitFor(
      async () => (await engine.getCollection(productCollection(shopId, 1)))?.numDocuments === 1001,
      120_000,
    );
    console.log(`[bench] 1,000-event burst fully indexed in ${burstMs} ms`);
  }, 180_000);
});
