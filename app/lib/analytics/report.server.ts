import { labelFor } from "../config/sort-options";
import { urlParamFor } from "../search/query/filters";
import { loadShopConfig, type Db } from "../shop/shop.server";
import { getKpis, type Kpis } from "./kpi.server";

// Trang Analytics (task 3.7, mục 8): top query, query không có kết quả (để tạo synonym/redirect nhanh),
// mức dùng filter và sort. Đọc từ bảng rollup (AnalyticsDaily / AnalyticsUsageDaily) — ẩn danh (D13).

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export type QueryRow = {
  query: string;
  searches: number;
  clicks: number;
  ctr: number;
  addToCarts: number;
  revenue: number;
};
export type ZeroRow = { query: string; searches: number; zeroResults: number };
export type UsageRow = { key: string; label: string; value: string; count: number; share: number };

export type AnalyticsReport = {
  range: Range;
  kpis: Kpis;
  topQueries: QueryRow[];
  zeroResults: ZeroRow[];
  filterUsage: UsageRow[];
  sortUsage: UsageRow[];
};

export const parseRange = (v: string | null): Range =>
  (RANGES as readonly number[]).includes(Number(v)) ? (Number(v) as Range) : 30;

const DAY = 24 * 3600_000;
const LIMIT = 50;

export async function getAnalyticsReport(
  db: Db,
  shopId: string,
  locale: string,
  range: Range = 30,
  now = new Date(),
): Promise<AnalyticsReport> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY);
  const start = new Date(end.getTime() - range * DAY);
  const where = { shopId, date: { gte: start, lt: end } };
  // Query rỗng ("" = mở trang search không có từ khoá / duyệt collection) không tính vào top query.
  const named = { ...where, query: { not: "" } };

  const [kpis, top, zero, usage, config] = await Promise.all([
    getKpis(db, shopId, range, now),
    db.analyticsDaily.groupBy({
      by: ["query"],
      where: named,
      _sum: { searches: true, clicks: true, addToCarts: true, revenueShopCurrency: true },
      orderBy: { _sum: { searches: "desc" } },
      take: LIMIT,
    }),
    db.analyticsDaily.groupBy({
      by: ["query"],
      where: { ...named, zeroResults: { gt: 0 } },
      _sum: { searches: true, zeroResults: true },
      orderBy: { _sum: { zeroResults: "desc" } },
      take: LIMIT,
    }),
    db.analyticsUsageDaily.groupBy({
      by: ["kind", "key", "value"],
      where,
      _sum: { count: true },
      orderBy: { _sum: { count: "desc" } },
      take: 200,
    }),
    loadShopConfig(db, shopId),
  ]);

  const filterLabels = new Map<string, string>();
  for (const f of [
    ...config.filters.default,
    ...(config.filters.search ?? []),
    ...Object.values(config.filters.collections).flat(),
  ])
    filterLabels.set(urlParamFor(f), labelFor(f.label, locale, f.id));
  const sortLabels = new Map(
    config.sortOptions.map((o) => [o.key, labelFor(o.label, locale, o.key)]),
  );

  const usageRows = (kind: "FILTER" | "SORT", labels: Map<string, string>) => {
    const rows = usage.filter((u) => u.kind === kind);
    const total = rows.reduce((n, u) => n + (u._sum.count ?? 0), 0);
    return rows.slice(0, LIMIT).map((u) => ({
      key: u.key,
      label: labels.get(u.key) ?? u.key,
      value: u.value,
      count: u._sum.count ?? 0,
      share: total ? (u._sum.count ?? 0) / total : 0,
    }));
  };

  return {
    range,
    kpis,
    topQueries: top.map((q) => {
      const searches = q._sum.searches ?? 0;
      const clicks = q._sum.clicks ?? 0;
      return {
        query: q.query,
        searches,
        clicks,
        ctr: searches ? clicks / searches : 0,
        addToCarts: q._sum.addToCarts ?? 0,
        revenue: Number(q._sum.revenueShopCurrency ?? 0),
      };
    }),
    zeroResults: zero.map((q) => ({
      query: q.query,
      searches: q._sum.searches ?? 0,
      zeroResults: q._sum.zeroResults ?? 0,
    })),
    filterUsage: usageRows("FILTER", filterLabels),
    sortUsage: usageRows("SORT", sortLabels),
  };
}
