import type { Redis } from "ioredis";

// Tiện ích HTTP của search-api: rate limit, micro-cache, CORS. Thuần / tiêm phụ thuộc để test.

export type RateDecision = { allowed: boolean; remaining: number; resetSec: number };

/** Fixed window theo phút trên Redis; Redis lỗi → bộ đếm trong process (không chặn traffic thật vì Redis sập). */
export class RateLimiter {
  private local = new Map<string, { window: number; count: number }>();

  constructor(
    private readonly redis: Redis | undefined,
    private readonly prefix: string,
    private readonly now: () => number = Date.now,
  ) {}

  async hit(key: string, limit: number): Promise<RateDecision> {
    const t = this.now();
    const window = Math.floor(t / 60_000);
    const resetSec = 60 - Math.floor((t % 60_000) / 1000);
    let count: number;
    try {
      if (!this.redis) throw new Error("no redis");
      const k = `${this.prefix}:rl:${key}:${window}`;
      const r = await this.redis.multi().incr(k).expire(k, 120).exec();
      count = Number(r?.[0]?.[1] ?? 0);
    } catch {
      const cur = this.local.get(key);
      count = cur && cur.window === window ? cur.count + 1 : 1;
      this.local.set(key, { window, count });
      // Không giữ IP quá cửa sổ hiện tại (chính sách quyền riêng tư: tối đa ~2 phút) và không phình bộ nhớ.
      if (this.local.size > 10_000)
        for (const [k, v] of this.local) if (v.window < window) this.local.delete(k);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSec };
  }
}

/** LRU nhỏ có TTL cho response JSON (giữ p95 thấp khi nhiều khách gõ cùng query). */
export class MicroCache<V> {
  private map = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly max = 5000,
    private readonly ttlMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V) {
    this.map.set(key, { at: this.now(), value });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  /** Xoá theo tiền tố (purge theo shop). */
  deletePrefix(prefix: string) {
    for (const k of this.map.keys()) if (k.startsWith(prefix)) this.map.delete(k);
  }

  get size() {
    return this.map.size;
  }
}

/**
 * Origin hợp lệ cho storefront của shop: domain shop (myshopify, primary, domain theo market), theme preview.
 * Origin khác = dùng headless (ngoài theme) → chỉ cho phép khi bật headless (gói ≥ $49).
 */
export function originKind(
  origin: string | null | undefined,
  domains: string[],
): "storefront" | "headless" | "none" {
  if (!origin) return "none";
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return "headless";
  }
  const known = new Set(domains.map((d) => d.toLowerCase()));
  if (known.has(host)) return "storefront";
  if (host.endsWith(".shopifypreview.com")) return "storefront";
  return "headless";
}

/** So sánh hằng thời gian cho public key. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
