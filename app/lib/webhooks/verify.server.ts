import { createHmac, timingSafeEqual } from "node:crypto";

// Xác thực webhook + Events (cùng cơ chế: base64 HMAC-SHA256 trên raw body, khoá = client secret).
// Tự làm thay vì authenticate.webhook để không tra/refresh session ở mỗi webhook (giữ < 500 ms) — D7.
// Nguồn: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries, docs/shopify-api/config-extensions.md mục 3.

export function verifyShopifyHmac(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type VerifiedWebhook = {
  kind: "webhook" | "event";
  topic: string;
  shop: string;
  webhookId: string;
  triggeredAt: string | null;
  apiVersion: string | null;
  /** Events API */
  handle?: string;
  action?: string;
  payload: Record<string, unknown>;
};

const fail = (status: number, statusText: string) =>
  new Response(undefined, { status, statusText });

/** Ném Response 405/401/400 (React Router trả thẳng về Shopify). */
export async function readVerifiedWebhook(
  request: Request,
  secret: string,
): Promise<VerifiedWebhook> {
  if (request.method !== "POST") throw fail(405, "Method not allowed");
  const raw = await request.text();
  const h = request.headers;
  if (
    !verifyShopifyHmac(raw, h.get("x-shopify-hmac-sha256") ?? h.get("shopify-hmac-sha256"), secret)
  ) {
    throw fail(401, "Unauthorized");
  }
  const topic = h.get("x-shopify-topic") ?? h.get("shopify-topic") ?? "";
  const shop = h.get("x-shopify-shop-domain") ?? h.get("shopify-shop-domain") ?? "";
  const webhookId =
    h.get("x-shopify-webhook-id") ??
    h.get("shopify-webhook-id") ??
    h.get("x-shopify-event-id") ??
    "";
  if (!topic || !shop || !webhookId) throw fail(400, "Bad Request");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw fail(400, "Bad Request");
  }
  const handle = h.get("shopify-handle") ?? h.get("x-shopify-handle") ?? undefined;
  return {
    kind: handle ? "event" : "webhook",
    topic,
    shop,
    webhookId,
    triggeredAt: h.get("x-shopify-triggered-at") ?? h.get("shopify-triggered-at"),
    apiVersion: h.get("x-shopify-api-version") ?? h.get("shopify-api-version"),
    ...(handle
      ? { handle, action: h.get("shopify-action") ?? h.get("x-shopify-action") ?? undefined }
      : {}),
    payload,
  };
}
