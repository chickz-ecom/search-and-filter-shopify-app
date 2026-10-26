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
  | {
      type: "click";
      query?: string;
      productId: string;
      position?: number;
      /** 7.1: nơi khách bấm — trang search, trang collection, dropdown gợi ý. */
      source?: "search" | "collection" | "instant";
      collectionId?: string;
    }
  | {
      type: "add_to_cart";
      query?: string;
      collectionId?: string;
      productId: string;
      revenue?: number;
    }
  | {
      type: "purchase";
      query?: string;
      collectionId?: string;
      revenue?: number;
      /** 7.1: từng dòng của đơn (pixel checkout_completed), doanh thu đã quy về currency gốc. */
      items?: { productId: string; qty: number; revenue?: number }[];
    }
  | { type: "filter"; key: string; value: string; scope?: string }
  | { type: "filter_combo"; scope?: string; values: string[] }
  | { type: "collection_view"; collectionId: string }
  | { type: "suggestion"; query: string; suggestion: string }
  | { type: "sort"; key: string };

const clean = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
/** "|" là dấu phân cách field trong hash → không cho lọt vào phần tự do. */
const part = (v: string, max: number) => String(v).replace(/\|/g, " ").slice(0, max);
/** Id sản phẩm/collection: số hoặc GID → số; còn lại bỏ. */
const numId = (v: unknown): string | null => {
  const id =
    String(v ?? "")
      .split("/")
      .pop() ?? "";
  return /^\d{1,20}$/.test(id) ? id : null;
};
/** Ngữ cảnh filter: "search", id collection, hoặc "" (không rõ). */
const scopeOf = (v: unknown) => (v === "search" ? "search" : (numId(v) ?? ""));
const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : 0;
};

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
      case "click": {
        m.hincrby(key, `c|${clean(e.query ?? "")}`, 1);
        const pid = numId(e.productId);
        if (!pid) break;
        m.hincrby(key, `P|${pid}|c`, 1);
        const cid = numId(e.collectionId);
        if (e.source === "collection") {
          m.hincrby(key, `P|${pid}|cc`, 1);
          if (cid) m.hincrby(key, `K|${cid}|c`, 1);
        } else m.hincrby(key, `P|${pid}|cs`, 1);
        break;
      }
      case "add_to_cart": {
        m.hincrby(key, `a|${clean(e.query ?? "")}`, 1);
        if (e.revenue && e.revenue > 0) m.hincrbyfloat(key, `r|${clean(e.query ?? "")}`, e.revenue);
        const pid = numId(e.productId);
        if (pid) m.hincrby(key, `P|${pid}|a`, 1);
        break;
      }
      case "purchase": {
        const q = e.query ? clean(e.query) : "";
        const cid = numId(e.collectionId);
        const revenue = money(e.revenue);
        let qty = 0;
        for (const it of (e.items ?? []).slice(0, 100)) {
          const pid = numId(it.productId);
          const n = Math.min(1000, Math.max(0, Math.floor(Number(it.qty) || 0)));
          if (!pid || !n) continue;
          qty += n;
          m.hincrby(key, `P|${pid}|b`, n);
          const r = money(it.revenue);
          if (r) m.hincrbyfloat(key, `P|${pid}|r`, r);
        }
        if (q) {
          if (revenue) m.hincrbyfloat(key, `r|${q}`, revenue);
          m.hincrby(key, `n|${q}`, 1);
          if (qty) m.hincrby(key, `b|${q}`, qty);
        } else if (cid) {
          m.hincrby(key, `K|${cid}|n`, 1);
          if (qty) m.hincrby(key, `K|${cid}|b`, qty);
          if (revenue) m.hincrbyfloat(key, `K|${cid}|r`, revenue);
        }
        break;
      }
      case "filter":
        m.hincrby(key, `F|${scopeOf(e.scope)}|${part(e.key, 64)}|${part(e.value, 100)}`, 1);
        break;
      case "filter_combo": {
        const values = (Array.isArray(e.values) ? e.values : [])
          .slice(0, 8)
          .map((v) => part(v, 60).replace(/&/g, " "))
          .filter(Boolean)
          .sort();
        if (values.length >= 2) m.hincrby(key, `X|${scopeOf(e.scope)}|${values.join("&")}`, 1);
        break;
      }
      case "collection_view": {
        const cid = numId(e.collectionId);
        if (cid) m.hincrby(key, `K|${cid}|v`, 1);
        break;
      }
      case "suggestion": {
        const q = part(clean(e.query ?? ""), 100);
        const sug = part(
          String(e.suggestion ?? "")
            .trim()
            .slice(0, 100),
          100,
        );
        if (q && sug) m.hincrby(key, `G|${q}|${sug}`, 1);
        break;
      }
      case "sort":
        m.hincrby(key, `o|${part(e.key, 64)}`, 1);
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
