import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readVerifiedWebhook, verifyShopifyHmac } from "./verify.server";
import { webhookActions } from "./actions";

const SECRET = "shpss_test_secret";
const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("base64");

function req(body: string, headers: Record<string, string> = {}, method = "POST") {
  return new Request("https://app.example/webhooks/products", {
    method,
    body: method === "POST" ? body : undefined,
    headers: {
      "X-Shopify-Hmac-Sha256": sign(body),
      "X-Shopify-Topic": "products/update",
      "X-Shopify-Shop-Domain": "shop.myshopify.com",
      "X-Shopify-Webhook-Id": "wh-1",
      "X-Shopify-Triggered-At": "2026-10-26T01:00:00Z",
      "X-Shopify-API-Version": "2026-10",
      ...headers,
    },
  });
}

describe("verifyShopifyHmac", () => {
  it("accepts a valid base64 signature over the raw body", () => {
    expect(verifyShopifyHmac('{"id":1}', sign('{"id":1}'), SECRET)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, missing or malformed headers", () => {
    expect(verifyShopifyHmac('{"id":2}', sign('{"id":1}'), SECRET)).toBe(false);
    expect(verifyShopifyHmac('{"id":1}', sign('{"id":1}', "other"), SECRET)).toBe(false);
    expect(verifyShopifyHmac('{"id":1}', null, SECRET)).toBe(false);
    expect(verifyShopifyHmac('{"id":1}', "short", SECRET)).toBe(false);
    expect(verifyShopifyHmac('{"id":1}', sign('{"id":1}'), "")).toBe(false);
  });
});

describe("readVerifiedWebhook", () => {
  it("returns the parsed webhook", async () => {
    const w = await readVerifiedWebhook(req('{"id":123,"updated_at":"x"}'), SECRET);
    expect(w).toMatchObject({
      topic: "products/update",
      shop: "shop.myshopify.com",
      webhookId: "wh-1",
      triggeredAt: "2026-10-26T01:00:00Z",
      payload: { id: 123 },
      kind: "webhook",
    });
  });

  it("reads Events API deliveries (shopify-handle / shopify-action headers)", async () => {
    const body =
      '{"topic":"Collection","action":"update","handle":"collection-products","fields_changed":{"added":[],"updated":[],"removed":[]}}';
    const w = await readVerifiedWebhook(
      req(body, {
        "X-Shopify-Hmac-Sha256": sign(body),
        "X-Shopify-Topic": "Collection",
        "Shopify-Handle": "collection-products",
        "Shopify-Action": "update",
      }),
      SECRET,
    );
    expect(w).toMatchObject({
      kind: "event",
      topic: "Collection",
      handle: "collection-products",
      action: "update",
    });
  });

  it("throws 401 on bad HMAC, 405 on GET, 400 on bad JSON or missing headers", async () => {
    const bad = await readVerifiedWebhook(
      req('{"id":1}', { "X-Shopify-Hmac-Sha256": sign("x") }),
      SECRET,
    ).catch((r: Response) => r);
    expect((bad as Response).status).toBe(401);
    const get = await readVerifiedWebhook(req("", {}, "GET"), SECRET).catch((r: Response) => r);
    expect((get as Response).status).toBe(405);
    const json = await readVerifiedWebhook(
      req("not json", { "X-Shopify-Hmac-Sha256": sign("not json") }),
      SECRET,
    ).catch((r: Response) => r);
    expect((json as Response).status).toBe(400);
    const noShop = await readVerifiedWebhook(
      req("{}", { "X-Shopify-Shop-Domain": "" }),
      SECRET,
    ).catch((r: Response) => r);
    expect((noShop as Response).status).toBe(400);
  });
});

describe("webhookActions (topic → job)", () => {
  it("maps product topics", () => {
    expect(webhookActions("products/update", { id: 1, updated_at: "x" })).toEqual([
      { kind: "incremental", productIds: ["1"] },
    ]);
    expect(webhookActions("products/create", { id: 2 })).toEqual([
      { kind: "incremental", productIds: ["2"] },
    ]);
    expect(webhookActions("products/delete", { id: 3 })).toEqual([
      { kind: "delete", productIds: ["3"] },
    ]);
  });

  it("maps collection, inventory and shop topics", () => {
    expect(webhookActions("collections/update", { id: 9 })).toEqual([
      { kind: "collection", collectionId: "9" },
    ]);
    expect(webhookActions("collections/delete", { id: 9 })).toEqual([
      { kind: "collection", collectionId: "9", deleted: true },
    ]);
    expect(
      webhookActions("inventory_levels/update", { inventory_item_id: 77, location_id: 1 }),
    ).toEqual([{ kind: "inventory", inventoryItemIds: ["77"] }]);
    expect(webhookActions("inventory_items/update", { id: 78 })).toEqual([
      { kind: "inventory", inventoryItemIds: ["78"] },
    ]);
    expect(webhookActions("markets/update", {})).toEqual([
      { kind: "shop-refresh", what: ["markets"] },
    ]);
    expect(webhookActions("locales/create", {})).toEqual([
      { kind: "shop-refresh", what: ["locales"] },
    ]);
    expect(webhookActions("shop/update", {})).toEqual([{ kind: "shop-refresh", what: ["shop"] }]);
  });

  it("maps bulk, app lifecycle and compliance topics", () => {
    expect(
      webhookActions("bulk_operations/finish", {
        admin_graphql_api_id: "gid://shopify/BulkOperation/5",
        status: "completed",
      }),
    ).toEqual([
      { kind: "bulk-finished", bulkId: "gid://shopify/BulkOperation/5", status: "completed" },
    ]);
    expect(webhookActions("app/uninstalled", {})).toEqual([{ kind: "uninstall" }]);
    expect(webhookActions("shop/redact", { shop_domain: "x.myshopify.com" })).toEqual([
      { kind: "redact" },
    ]);
    expect(webhookActions("customers/redact", {})).toEqual([{ kind: "log" }]);
    expect(webhookActions("customers/data_request", {})).toEqual([{ kind: "log" }]);
    expect(webhookActions("unknown/topic", {})).toEqual([]);
  });

  it("ignores payloads without ids", () => {
    expect(webhookActions("products/update", {})).toEqual([]);
  });
});

describe("eventActions (Events API, D8)", () => {
  it("maps collection.products added/removed", async () => {
    const { eventActions } = await import("./actions");
    expect(
      eventActions({
        topic: "Collection",
        action: "update",
        handle: "collection-products",
        fields_changed: {
          added: [
            "collection[id: 'gid://shopify/Collection/8'].products[id: 'gid://shopify/Product/5']",
          ],
          updated: [],
          removed: [
            "collection[id: 'gid://shopify/Collection/8'].products[id: 'gid://shopify/Product/6']",
          ],
        },
      }),
    ).toEqual([{ kind: "collection", collectionId: "8", added: ["5"], removed: ["6"] }]);
  });

  it("maps collection.sortOrder with query data, and deletes", async () => {
    const { eventActions } = await import("./actions");
    expect(
      eventActions({
        topic: "Collection",
        action: "update",
        handle: "collection-sort-order",
        data: { collection: { id: "gid://shopify/Collection/8", sortOrder: "PRICE_ASC" } },
        fields_changed: {
          added: [],
          updated: ["collection[id: 'gid://shopify/Collection/8'].sortOrder"],
          removed: [],
        },
      }),
    ).toEqual([{ kind: "collection", collectionId: "8", sortOrder: "PRICE_ASC" }]);
    expect(
      eventActions({
        topic: "Collection",
        action: "delete",
        data: { collection: null },
        query_variables: { collectionId: "gid://shopify/Collection/9" },
      }),
    ).toEqual([{ kind: "collection", collectionId: "9", deleted: true }]);
    expect(eventActions({ topic: "Product" })).toEqual([]);
  });
});
