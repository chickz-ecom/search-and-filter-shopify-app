import { describe, expect, it } from "vitest";
import { MicroCache, originKind, RateLimiter, safeEqual } from "./http-utils";

describe("search-api http utils", () => {
  it("rate limits per minute window (in-process fallback when Redis is absent)", async () => {
    let t = 0;
    const rl = new RateLimiter(undefined, "x", () => t);
    for (let i = 0; i < 3; i++) expect((await rl.hit("ip:1", 3)).allowed).toBe(true);
    expect(await rl.hit("ip:1", 3)).toMatchObject({ allowed: false, remaining: 0 });
    expect((await rl.hit("ip:2", 3)).allowed).toBe(true);
    t = 61_000;
    expect((await rl.hit("ip:1", 3)).allowed).toBe(true);
  });

  it("micro-caches with TTL, LRU eviction and prefix purge", () => {
    let t = 0;
    const c = new MicroCache<number>(2, 100, () => t);
    c.set("s1:a", 1);
    c.set("s1:b", 2);
    c.get("s1:a");
    c.set("s2:c", 3); // đẩy s1:b (ít dùng nhất)
    expect(c.get("s1:b")).toBeUndefined();
    expect(c.get("s1:a")).toBe(1);
    c.deletePrefix("s1:");
    expect(c.get("s1:a")).toBeUndefined();
    t = 200;
    expect(c.get("s2:c")).toBeUndefined();
  });

  it("classifies origins", () => {
    const d = ["shop.myshopify.com", "shop.com", "shop.de"];
    expect(originKind("https://shop.com", d)).toBe("storefront");
    expect(originKind("https://SHOP.de", d)).toBe("storefront");
    expect(originKind("https://abc123.shopifypreview.com", d)).toBe("storefront");
    expect(originKind("https://evil.com", d)).toBe("headless");
    expect(originKind(null, d)).toBe("none");
  });

  it("compares keys in constant time", () => {
    expect(safeEqual("pk_abc", "pk_abc")).toBe(true);
    expect(safeEqual("pk_abc", "pk_abd")).toBe(false);
    expect(safeEqual("pk_abc", "pk_ab")).toBe(false);
  });
});
