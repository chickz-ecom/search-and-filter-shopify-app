import type { Redis } from "ioredis";
import type { Db } from "../shop/shop.server";
import { countersKey, dayKey, pendingDaysKey } from "./analytics.server";

// Rollup Redis → AnalyticsDaily / AnalyticsUsageDaily (task 2.13). Bộ đếm Redis là luỹ kế trong ngày → ghi đè giá trị
// (không cộng dồn) nên chạy lại bao nhiêu lần cũng đúng (idempotent). Ngày đã qua → bỏ khỏi danh sách chờ.

type Row = {
  searches: number;
  zeroResults: number;
  clicks: number;
  addToCarts: number;
  revenue: number;
};

export function parseCounters(hash: Record<string, string>) {
  const queries = new Map<string, Row>();
  const usage: { kind: "FILTER" | "SORT"; key: string; value: string; count: number }[] = [];
  const row = (q: string) => {
    let r = queries.get(q);
    if (!r)
      queries.set(q, (r = { searches: 0, zeroResults: 0, clicks: 0, addToCarts: 0, revenue: 0 }));
    return r;
  };
  for (const [field, raw] of Object.entries(hash)) {
    const [kind, ...rest] = field.split("|");
    const n = Number(raw) || 0;
    if (kind === "f")
      usage.push({ kind: "FILTER", key: rest[0] ?? "", value: rest.slice(1).join("|"), count: n });
    else if (kind === "o") usage.push({ kind: "SORT", key: rest.join("|"), value: "", count: n });
    else {
      const q = rest.join("|");
      const r = row(q);
      if (kind === "s") r.searches = n;
      else if (kind === "z") r.zeroResults = n;
      else if (kind === "c") r.clicks = n;
      else if (kind === "a") r.addToCarts = n;
      else if (kind === "r") r.revenue = Math.round(n * 100) / 100;
    }
  }
  return { queries, usage };
}

export async function rollupAnalytics(redis: Redis, db: Db, now = new Date()) {
  const pending = await redis.smembers(pendingDaysKey);
  const today = dayKey(now);
  let rows = 0;
  for (const entry of pending) {
    const [shopId, day] = entry.split("|");
    const shop = await db.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) {
      await redis.srem(pendingDaysKey, entry);
      continue;
    }
    const { queries, usage } = parseCounters(await redis.hgetall(countersKey(shopId, day)));
    const date = new Date(`${day}T00:00:00Z`);
    try {
      rows += await writeDay(db, shopId, date, queries, usage);
    } catch (e) {
      // Shop bị xoá (gỡ app) giữa lúc kiểm tra và lúc ghi → FK lỗi: bỏ ngày đó, không làm hỏng cả lượt rollup.
      if ((e as { code?: string }).code !== "P2003") throw e;
      await redis.srem(pendingDaysKey, entry);
      continue;
    }
    if (day < today) await redis.srem(pendingDaysKey, entry);
  }
  return { days: pending.length, rows };
}

async function writeDay(
  db: Db,
  shopId: string,
  date: Date,
  queries: ReturnType<typeof parseCounters>["queries"],
  usage: ReturnType<typeof parseCounters>["usage"],
) {
  let rows = 0;
  for (const [query, r] of queries) {
    await db.analyticsDaily.upsert({
      where: { shopId_date_query: { shopId, date, query } },
      update: {
        searches: r.searches,
        zeroResults: r.zeroResults,
        clicks: r.clicks,
        addToCarts: r.addToCarts,
        revenueShopCurrency: r.revenue,
      },
      create: {
        shopId,
        date,
        query,
        searches: r.searches,
        zeroResults: r.zeroResults,
        clicks: r.clicks,
        addToCarts: r.addToCarts,
        revenueShopCurrency: r.revenue,
      },
    });
    rows++;
  }
  for (const u of usage) {
    await db.analyticsUsageDaily.upsert({
      where: {
        shopId_date_kind_key_value: { shopId, date, kind: u.kind, key: u.key, value: u.value },
      },
      update: { count: u.count },
      create: { shopId, date, kind: u.kind, key: u.key, value: u.value, count: u.count },
    });
    rows++;
  }
  return rows;
}
