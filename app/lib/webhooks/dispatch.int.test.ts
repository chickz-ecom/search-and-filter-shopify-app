import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { ensureShop } from "../shop/shop.server";
import { handleWebhookRequest, type WebhookSink } from "./dispatch.server";

const up = await postgresUp();
const SECRET = "shpss_route_test";
const domain = `wh-${Date.now()}.myshopify.com`;
let n = 0;

function delivery(topic: string, payload: unknown, opts: { id?: string; secret?: string } = {}) {
  const body = JSON.stringify(payload);
  return new Request("https://app.example/webhooks/x", {
    method: "POST",
    body,
    headers: {
      "X-Shopify-Hmac-Sha256": createHmac("sha256", opts.secret ?? SECRET)
        .update(body)
        .digest("base64"),
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": domain,
      "X-Shopify-Webhook-Id": opts.id ?? `id-${Date.now()}-${n++}`,
      "X-Shopify-API-Version": "2026-10",
    },
  });
}

function sink(): WebhookSink & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    incremental: vi.fn(async (shopId, ids) => void calls.push(["incremental", shopId, ids])),
    sync: vi.fn(async (data) => void calls.push(["sync", data])),
    bulkFinished: vi.fn(async (id, status) => void calls.push(["bulk", id, status])),
  };
}

describe.skipIf(!up)("webhook routes (1.6)", () => {
  let shopId = "";
  beforeAll(async () => {
    shopId = (await ensureShop(testDb(), domain)).shop.id;
    await testDb().session.create({
      data: { id: `offline_${domain}`, shop: domain, state: "x", accessToken: "t" },
    });
  });
  afterAll(async () => {
    await testDb().webhookReceipt.deleteMany({ where: { shopDomain: domain } });
    await testDb().session.deleteMany({ where: { shop: domain } });
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("verifies, enqueues and answers 200 well under 500ms", async () => {
    const s = sink();
    const t0 = performance.now();
    const res = await handleWebhookRequest(
      delivery("products/update", { id: 42, updated_at: "x" }),
      { db: testDb(), sink: s, secret: SECRET },
    );
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(500);
    expect(s.calls).toEqual([["incremental", shopId, ["42"]]]);
  });

  it("dedupes by X-Shopify-Webhook-Id", async () => {
    const s = sink();
    await handleWebhookRequest(delivery("products/delete", { id: 7 }, { id: "dup-1" }), {
      db: testDb(),
      sink: s,
      secret: SECRET,
    });
    const again = await handleWebhookRequest(
      delivery("products/delete", { id: 7 }, { id: "dup-1" }),
      { db: testDb(), sink: s, secret: SECRET },
    );
    expect(again.status).toBe(200);
    expect(s.calls).toEqual([["sync", { type: "delete", shopId, productIds: ["7"] }]]);
  });

  it("returns 401 for a bad HMAC (compliance requirement) and enqueues nothing", async () => {
    const s = sink();
    const res = await handleWebhookRequest(
      delivery("shop/redact", { shop_domain: domain }, { secret: "wrong" }),
      {
        db: testDb(),
        sink: s,
        secret: SECRET,
      },
    ).catch((r: Response) => r);
    expect(res.status).toBe(401);
    expect(s.calls).toEqual([]);
  });

  it("publishes bulk finish signals and queues redact by domain", async () => {
    const s = sink();
    await handleWebhookRequest(
      delivery("bulk_operations/finish", {
        admin_graphql_api_id: "gid://shopify/BulkOperation/1",
        status: "completed",
      }),
      {
        db: testDb(),
        sink: s,
        secret: SECRET,
      },
    );
    await handleWebhookRequest(delivery("shop/redact", { shop_domain: domain }), {
      db: testDb(),
      sink: s,
      secret: SECRET,
    });
    expect(s.calls).toEqual([
      ["bulk", "gid://shopify/BulkOperation/1", "completed"],
      ["sync", { type: "redact", shopDomain: domain }],
    ]);
  });

  it("app/uninstalled deletes sessions, marks the shop and queues the uninstall job", async () => {
    const s = sink();
    await handleWebhookRequest(delivery("app/uninstalled", {}), {
      db: testDb(),
      sink: s,
      secret: SECRET,
    });
    expect(await testDb().session.count({ where: { shop: domain } })).toBe(0);
    expect(
      (await testDb().shop.findUniqueOrThrow({ where: { id: shopId } })).uninstalledAt,
    ).toBeTruthy();
    expect(s.calls).toEqual([["sync", { type: "uninstall", shopId }]]);
  });
});
