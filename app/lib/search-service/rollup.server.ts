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
  productsBought: number;
  orders: number;
};
type ProductRow = {
  clicks: number;
  searchClicks: number;
  collectionClicks: number;
  addToCarts: number;
  purchases: number;
  revenue: number;
};
type CollectionRow = {
  views: number;
  clicks: number;
  purchases: number;
  orders: number;
  revenue: number;
};
type UsageKind = "FILTER" | "SORT" | "FILTER_COMBO" | "SUGGESTION";
type Usage = { kind: UsageKind; scope: string; key: string; value: string; count: number };

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Field của hash ngày (analytics.server.ts): theo query `s|z|c|a|r|b|n|<query>`; theo sản phẩm `P|<id>|<c|cs|cc|a|b|r>`;
 * theo collection `K|<id>|<v|c|b|n|r>`; filter `F|<scope>|<key>|<value>` (cũ: `f|<key>|<value>`), tổ hợp
 * `X|<scope>|<combo>`, gợi ý `G|<query>|<suggestion>`, sort `o|<key>`.
 */
export function parseCounters(hash: Record<string, string>) {
  const queries = new Map<string, Row>();
  const products = new Map<string, ProductRow>();
  const collections = new Map<string, CollectionRow>();
  const usage: Usage[] = [];
  const row = (q: string) => {
    let r = queries.get(q);
    if (!r)
      queries.set(
        q,
        (r = {
          searches: 0,
          zeroResults: 0,
          clicks: 0,
          addToCarts: 0,
          revenue: 0,
          productsBought: 0,
          orders: 0,
        }),
      );
    return r;
  };
  const product = (id: string) => {
    let r = products.get(id);
    if (!r)
      products.set(
        id,
        (r = {
          clicks: 0,
          searchClicks: 0,
          collectionClicks: 0,
          addToCarts: 0,
          purchases: 0,
          revenue: 0,
        }),
      );
    return r;
  };
  const collection = (id: string) => {
    let r = collections.get(id);
    if (!r) collections.set(id, (r = { views: 0, clicks: 0, purchases: 0, orders: 0, revenue: 0 }));
    return r;
  };
  for (const [field, raw] of Object.entries(hash)) {
    const [kind, ...rest] = field.split("|");
    const n = Number(raw) || 0;
    switch (kind) {
      case "f":
        usage.push({
          kind: "FILTER",
          scope: "",
          key: rest[0] ?? "",
          value: rest.slice(1).join("|"),
          count: n,
        });
        continue;
      case "F":
        usage.push({
          kind: "FILTER",
          scope: rest[0] ?? "",
          key: rest[1] ?? "",
          value: rest.slice(2).join("|"),
          count: n,
        });
        continue;
      case "X":
        usage.push({
          kind: "FILTER_COMBO",
          scope: rest[0] ?? "",
          key: rest.slice(1).join("|"),
          value: "",
          count: n,
        });
        continue;
      case "G":
        usage.push({
          kind: "SUGGESTION",
          scope: "",
          key: rest[0] ?? "",
          value: rest.slice(1).join("|"),
          count: n,
        });
        continue;
      case "o":
        usage.push({ kind: "SORT", scope: "", key: rest.join("|"), value: "", count: n });
        continue;
      case "P": {
        const [id, f] = rest;
        const p = product(id);
        if (f === "c") p.clicks = n;
        else if (f === "cs") p.searchClicks = n;
        else if (f === "cc") p.collectionClicks = n;
        else if (f === "a") p.addToCarts = n;
        else if (f === "b") p.purchases = n;
        else if (f === "r") p.revenue = cents(n);
        continue;
      }
      case "K": {
        const [id, f] = rest;
        const c = collection(id);
        if (f === "v") c.views = n;
        else if (f === "c") c.clicks = n;
        else if (f === "b") c.purchases = n;
        else if (f === "n") c.orders = n;
        else if (f === "r") c.revenue = cents(n);
        continue;
      }
    }
    const r = row(rest.join("|"));
    if (kind === "s") r.searches = n;
    else if (kind === "z") r.zeroResults = n;
    else if (kind === "c") r.clicks = n;
    else if (kind === "a") r.addToCarts = n;
    else if (kind === "r") r.revenue = cents(n);
    else if (kind === "b") r.productsBought = n;
    else if (kind === "n") r.orders = n;
  }
  return { queries, usage, products, collections };
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
    const counters = parseCounters(await redis.hgetall(countersKey(shopId, day)));
    const date = new Date(`${day}T00:00:00Z`);
    try {
      rows += await writeDay(db, shopId, date, counters);
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
  { queries, usage, products, collections }: ReturnType<typeof parseCounters>,
) {
  let rows = 0;
  for (const [query, r] of queries) {
    const data = {
      searches: r.searches,
      zeroResults: r.zeroResults,
      clicks: r.clicks,
      addToCarts: r.addToCarts,
      revenueShopCurrency: r.revenue,
      productsBought: r.productsBought,
      orders: r.orders,
    };
    await db.analyticsDaily.upsert({
      where: { shopId_date_query: { shopId, date, query } },
      update: data,
      create: { shopId, date, query, ...data },
    });
    rows++;
  }
  for (const u of usage) {
    const id = { shopId, date, kind: u.kind, scope: u.scope, key: u.key, value: u.value };
    await db.analyticsUsageDaily.upsert({
      where: { shopId_date_kind_scope_key_value: id },
      update: { count: u.count },
      create: { ...id, count: u.count },
    });
    rows++;
  }
  for (const [productId, p] of products) {
    await db.analyticsProductDaily.upsert({
      where: { shopId_date_productId: { shopId, date, productId } },
      update: p,
      create: { shopId, date, productId, ...p },
    });
    rows++;
  }
  for (const [collectionId, c] of collections) {
    await db.analyticsCollectionDaily.upsert({
      where: { shopId_date_collectionId: { shopId, date, collectionId } },
      update: c,
      create: { shopId, date, collectionId, ...c },
    });
    rows++;
  }
  return rows;
}
