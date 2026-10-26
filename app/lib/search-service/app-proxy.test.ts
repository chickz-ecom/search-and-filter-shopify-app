import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appProxyMessage,
  rewriteProxyRequest,
  TRUSTED_SHOP_HEADER,
  verifyAppProxySignature,
} from "./app-proxy.server";

const SECRET = "hush";
const sign = (p: URLSearchParams) => {
  p.set("signature", createHmac("sha256", SECRET).update(appProxyMessage(p)).digest("hex"));
  return p;
};

describe("app proxy signature", () => {
  it("matches the documented message format", () => {
    const p = new URLSearchParams(
      "extra=1&extra=2&shop=s.myshopify.com&path_prefix=/apps/awesome_reviews&timestamp=1317327555&logged_in_customer_id=1&signature=x",
    );
    expect(appProxyMessage(p)).toBe(
      "extra=1,2logged_in_customer_id=1path_prefix=/apps/awesome_reviewsshop=s.myshopify.comtimestamp=1317327555",
    );
  });

  it("verifies valid signatures and rejects tampering / stale timestamps", () => {
    const now = 1_800_000_000;
    const p = sign(
      new URLSearchParams({ shop: "s.myshopify.com", timestamp: String(now), q: "tee" }),
    );
    expect(verifyAppProxySignature(p, SECRET, now)).toBe(true);
    const tampered = new URLSearchParams(p);
    tampered.set("q", "x");
    expect(verifyAppProxySignature(tampered, SECRET, now)).toBe(false);
    expect(verifyAppProxySignature(p, SECRET, now + 7200)).toBe(false);
    expect(verifyAppProxySignature(p, "other", now)).toBe(false);
  });

  it("rewrites to the search API with a trusted shop header and strips Shopify params", () => {
    const p = sign(
      new URLSearchParams({
        shop: "s.myshopify.com",
        timestamp: String(Math.floor(Date.now() / 1000)),
        q: "tee",
        logged_in_customer_id: "42",
        path_prefix: "/apps/search",
      }),
    );
    const out = rewriteProxyRequest(
      new Request(`https://app.example/proxy/v1/search?${p}`),
      SECRET,
    ) as Request;
    const u = new URL(out.url);
    expect(u.pathname).toBe("/v1/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "tee", shop: "s.myshopify.com" });
    expect(out.headers.get(TRUSTED_SHOP_HEADER)).toBe("s.myshopify.com");
    expect(
      (
        rewriteProxyRequest(
          new Request(`https://app.example/proxy/v1/search?q=1`),
          SECRET,
        ) as Response
      ).status,
    ).toBe(401);
  });
});
