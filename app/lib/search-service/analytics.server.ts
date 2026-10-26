import type { Redis } from "ioredis";
import { rkey } from "../redis.server";

// Đếm ẩn danh (D13): không lưu customer/IP. search-api ghi Redis (rẻ, không chặn response);
// worker rollup sang AnalyticsDaily (task 2.13).

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** Hash theo ngày: field `${kind}|${query}` → count. */
export const countersKey = (shopId: string, day: string) => rkey("an", shopId, day);
/** Set các ngày còn chờ rollup cho shop. */
export const pendingDaysKey = rkey("an", "pending");
/** Từ khoá phổ biến cho gợi ý (zset điểm = số lần search có kết quả). */
export const popularKey = (shopId: string) => rkey("popular", shopId);

export type AnalyticsEvent =
  | { type: "search"; query: string; results: number }
  | { type: "click"; query?: string; productId: string; position?: number }
  | { type: "add_to_cart"; query?: string; productId: string; revenue?: number }
  | { type: "filter"; key: string; value: string }
  | { type: "sort"; key: string };

const clean = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);

export async function recordEvents(
  redis: Redis,
  shopId: string,
  events: AnalyticsEvent[],
  now = new Date(),
) {
  if (!events.length) return;
  const day = dayKey(now);
  const key = countersKey(shopId, day);
  const m = redis.multi();
  for (const e of events) {
    switch (e.type) {
      case "search": {
        const q = clean(e.query);
        if (!q) break;
        m.hincrby(key, `s|${q}`, 1);
        if (e.results === 0) m.hincrby(key, `z|${q}`, 1);
        else m.zincrby(popularKey(shopId), 1, q);
        break;
      }
      case "click":
        m.hincrby(key, `c|${clean(e.query ?? "")}`, 1);
        break;
      case "add_to_cart":
        m.hincrby(key, `a|${clean(e.query ?? "")}`, 1);
        if (e.revenue && e.revenue > 0) m.hincrbyfloat(key, `r|${clean(e.query ?? "")}`, e.revenue);
        break;
      case "filter":
        m.hincrby(key, `f|${e.key.slice(0, 64)}|${e.value.slice(0, 100)}`, 1);
        break;
      case "sort":
        m.hincrby(key, `o|${e.key.slice(0, 64)}`, 1);
        break;
    }
  }
  m.expire(key, 14 * 24 * 3600);
  m.sadd(pendingDaysKey, `${shopId}|${day}`);
  await m.exec();
}

export async function popularQueries(
  redis: Redis,
  shopId: string,
  prefix: string,
  limit = 5,
): Promise<string[]> {
  const p = clean(prefix);
  if (!p) return [];
  // Top 200 rồi lọc tiền tố (đủ nhẹ; zset nhỏ).
  const top = await redis.zrevrange(popularKey(shopId), 0, 199);
  return top.filter((q) => q.startsWith(p) && q !== p).slice(0, limit);
}
