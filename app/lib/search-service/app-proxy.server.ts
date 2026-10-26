import { createHmac, timingSafeEqual } from "node:crypto";

// App proxy (https://{shop}/apps/search/* → /proxy/*): same-origin cho SDK, tránh CORS (mục 6.2 endpoint).
// Chữ ký: bỏ `signature`, ghép key=value (giá trị lặp nối bằng ","), sort, nối liền KHÔNG dấu phân cách,
// HMAC-SHA256 hex bằng client secret (docs/shopify-api/config-extensions.md mục 7).

export function appProxyMessage(params: URLSearchParams): string {
  const grouped = new Map<string, string[]>();
  for (const [k, v] of params) {
    if (k === "signature") continue;
    grouped.set(k, [...(grouped.get(k) ?? []), v]);
  }
  return [...grouped.entries()]
    .map(([k, vs]) => `${k}=${vs.join(",")}`)
    .sort()
    .join("");
}

export function verifyAppProxySignature(
  params: URLSearchParams,
  secret: string,
  nowSec = Date.now() / 1000,
): boolean {
  const sig = params.get("signature");
  if (!sig || !secret || !/^[0-9a-f]+$/i.test(sig)) return false;
  // Chống phát lại thô: timestamp lệch quá 1 giờ thì từ chối.
  const ts = Number(params.get("timestamp"));
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 3600) return false;
  const expected = createHmac("sha256", secret).update(appProxyMessage(params)).digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Header nội bộ báo search-api rằng shop đã được xác thực bằng chữ ký app proxy. */
export const TRUSTED_SHOP_HEADER = "x-searchapp-proxy-shop";

/**
 * Viết lại request proxy thành request search-api: /proxy/v1/search?... → /v1/search?...
 * Bỏ tham số của Shopify (signature, logged_in_customer_id…) — không dùng dữ liệu khách hàng (D13).
 */
export function rewriteProxyRequest(request: Request, secret: string): Request | Response {
  const url = new URL(request.url);
  if (!verifyAppProxySignature(url.searchParams, secret))
    return new Response("Unauthorized", { status: 401 });
  const shop = url.searchParams.get("shop") ?? "";
  const path = url.pathname.replace(/^\/proxy/, "") || "/";
  if (!path.startsWith("/v1/")) return new Response("Not found", { status: 404 });
  const out = new URL(path, "http://search-api.internal");
  for (const [k, v] of url.searchParams) {
    if (
      ["signature", "logged_in_customer_id", "path_prefix", "timestamp", "shop", "key"].includes(k)
    )
      continue;
    out.searchParams.append(k, v);
  }
  out.searchParams.set("shop", shop);
  const headers = new Headers({ [TRUSTED_SHOP_HEADER]: shop });
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  return new Request(out, {
    method: request.method,
    headers,
    body: request.method === "POST" ? request.body : undefined,
    duplex: "half",
  } as RequestInit);
}
