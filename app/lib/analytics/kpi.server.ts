import type { Db } from "../shop/shop.server";

// KPI cho Home (BFS: Home có metric chính) và trang Analytics.
export type Kpis = {
  searches: number;
  zeroResultRate: number;
  clicks: number;
  ctr: number;
  addToCarts: number;
  revenue: number;
  previous: { searches: number; zeroResultRate: number; ctr: number; revenue: number };
};

async function sum(db: Db, shopId: string, from: Date, to: Date) {
  const r = await db.analyticsDaily.aggregate({
    where: { shopId, date: { gte: from, lt: to } },
    _sum: {
      searches: true,
      zeroResults: true,
      clicks: true,
      addToCarts: true,
      revenueShopCurrency: true,
    },
  });
  const searches = r._sum.searches ?? 0;
  const clicks = r._sum.clicks ?? 0;
  return {
    searches,
    zeroResultRate: searches ? (r._sum.zeroResults ?? 0) / searches : 0,
    clicks,
    ctr: searches ? clicks / searches : 0,
    addToCarts: r._sum.addToCarts ?? 0,
    revenue: Number(r._sum.revenueShopCurrency ?? 0),
  };
}

const startOfDayUtc = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function getKpis(db: Db, shopId: string, days = 7, now = new Date()): Promise<Kpis> {
  const end = new Date(startOfDayUtc(now).getTime() + 24 * 3600_000);
  const start = new Date(end.getTime() - days * 24 * 3600_000);
  const prevStart = new Date(start.getTime() - days * 24 * 3600_000);
  const [cur, prev] = await Promise.all([
    sum(db, shopId, start, end),
    sum(db, shopId, prevStart, start),
  ]);
  return {
    ...cur,
    previous: {
      searches: prev.searches,
      zeroResultRate: prev.zeroResultRate,
      ctr: prev.ctr,
      revenue: prev.revenue,
    },
  };
}
