import type { SearchEngine } from "../search/engine";
import { contentAlias, productAlias } from "../search/names";
import { fromMinorUnits } from "../search/query/currency";
import { urlParamFor } from "../search/query/filters";
import { labelFor } from "../config/sort-options";
import { loadShopConfig, type Db } from "../shop/shop.server";
import { daysIn, parseDateRange, rangeBounds, type DateRange } from "./range";
import {
  METRICS,
  type Column,
  type MetricKey,
  type Overview,
  type ProductRef,
  type ReportKey,
  type Table,
} from "./report-types";

export * from "./report-types";

// Analytics v2 (7.2): Overview, Search, Collections, Export. Đọc bảng rollup (ẩn danh, D13) + tra tên/ảnh sản phẩm
// và tên collection trong index. Mỗi báo cáo bảng trả về ĐỦ dòng của khoảng ngày; tìm/sắp xếp/phân trang ở
// `pageRows`, CSV dùng chung dòng đó (`csvOf`).

export type Ctx = {
  db: Db;
  engine: SearchEngine;
  shopId: string;
  currency: string;
  locale: string;
};

const TOP = 5;
const num = (v: unknown) => Number(v ?? 0) || 0;
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const zero = (): Record<MetricKey, number> => ({
  clicks: 0,
  searches: 0,
  zeroResults: 0,
  clickedValue: 0,
  filtersApplied: 0,
  boughtValue: 0,
});
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

// ---------- tra cứu trong index ----------

/** Tên/ảnh sản phẩm + giá (minor units, currency gốc) theo id; sản phẩm đã xoá → "Product #id". */
export async function lookupProducts(
  engine: SearchEngine,
  shopId: string,
  ids: string[],
): Promise<Map<string, ProductRef & { price: number }>> {
  const out = new Map<string, ProductRef & { price: number }>();
  const uniq = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
  for (let i = 0; i < uniq.length; i += 250) {
    const batch = uniq.slice(i, i + 250);
    const r = await engine
      .search<{ id: string; title: string; image?: string; handle?: string; price_min?: number }>(
        productAlias(shopId),
        {
          q: "*",
          queryBy: ["title"],
          filterBy: `id:[${batch.join(",")}]`,
          perPage: 250,
          includeFields: ["id", "title", "image", "handle", "price_min"],
        },
      )
      .catch(() => null);
    for (const h of r?.hits ?? []) {
      const d = h.document;
      out.set(d.id, {
        id: d.id,
        title: d.title,
        image: d.image ?? null,
        handle: d.handle ?? null,
        price: num(d.price_min),
      });
    }
  }
  for (const id of uniq)
    if (!out.has(id))
      out.set(id, { id, title: `Product #${id}`, image: null, handle: null, price: 0 });
  return out;
}

/** Tên collection theo id (index nội dung, doc `collection-{id}`). */
export async function lookupCollections(
  engine: SearchEngine,
  shopId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
  for (let i = 0; i < uniq.length; i += 250) {
    const batch = uniq.slice(i, i + 250).map((id) => `collection-${id}`);
    const r = await engine
      .search<{ id: string; title: string }>(contentAlias(shopId), {
        q: "*",
        queryBy: ["title"],
        filterBy: `id:[${batch.join(",")}]`,
        perPage: 250,
        includeFields: ["id", "title"],
      })
      .catch(() => null);
    for (const h of r?.hits ?? [])
      out.set(h.document.id.replace(/^collection-/, ""), h.document.title);
  }
  for (const id of uniq) if (!out.has(id)) out.set(id, `Collection #${id}`);
  return out;
}

/** Nhãn filter theo id và theo tham số URL (dữ liệu cũ ghi key dạng filter.p.vendor). */
async function filterLabels(ctx: Ctx) {
  const config = await loadShopConfig(ctx.db, ctx.shopId);
  const labels = new Map<string, string>();
  for (const f of [
    ...config.filters.default,
    ...(config.filters.search ?? []),
    ...Object.values(config.filters.collections).flat(),
  ]) {
    const label = labelFor(f.label, ctx.locale, f.id);
    labels.set(f.id, label);
    labels.set(urlParamFor(f), label);
  }
  return (key: string) => labels.get(key) ?? key;
}

/** "vendor=Nike&size=M" → "Brand: Nike + Size: M". */
const comboLabel = (combo: string, label: (k: string) => string) =>
  combo
    .split("&")
    .map((pair) => {
      const i = pair.indexOf("=");
      return i < 0 ? pair : `${label(pair.slice(0, i))}: ${pair.slice(i + 1)}`;
    })
    .join(" + ");

// ---------- Overview ----------

export async function getOverview(ctx: Ctx, range: DateRange): Promise<Overview> {
  const { db, shopId } = ctx;
  const date = rangeBounds(range);
  const where = { shopId, date };
  const [
    named,
    allClicks,
    filters,
    bought,
    productClicks,
    topQ,
    topZ,
    topClick,
    topBuy,
    fUsage,
    fvUsage,
    topCol,
  ] = await Promise.all([
    db.analyticsDaily.groupBy({
      by: ["date"],
      where: { ...where, query: { not: "" } },
      _sum: { searches: true, zeroResults: true },
    }),
    db.analyticsDaily.groupBy({ by: ["date"], where, _sum: { clicks: true } }),
    db.analyticsUsageDaily.groupBy({
      by: ["date"],
      where: { ...where, kind: "FILTER" },
      _sum: { count: true },
    }),
    db.analyticsProductDaily.groupBy({ by: ["date"], where, _sum: { revenue: true } }),
    db.analyticsProductDaily.groupBy({
      by: ["date", "productId"],
      where: { ...where, clicks: { gt: 0 } },
      _sum: { clicks: true },
    }),
    db.analyticsDaily.groupBy({
      by: ["query"],
      where: { ...where, query: { not: "" } },
      _sum: { searches: true },
      orderBy: { _sum: { searches: "desc" } },
      take: TOP,
    }),
    db.analyticsDaily.groupBy({
      by: ["query"],
      where: { ...where, query: { not: "" }, zeroResults: { gt: 0 } },
      _sum: { zeroResults: true },
      orderBy: { _sum: { zeroResults: "desc" } },
      take: TOP,
    }),
    db.analyticsProductDaily.groupBy({
      by: ["productId"],
      where: { ...where, clicks: { gt: 0 } },
      _sum: { clicks: true },
      orderBy: { _sum: { clicks: "desc" } },
      take: TOP,
    }),
    db.analyticsProductDaily.groupBy({
      by: ["productId"],
      where: { ...where, purchases: { gt: 0 } },
      _sum: { purchases: true },
      orderBy: { _sum: { purchases: "desc" } },
      take: TOP,
    }),
    db.analyticsUsageDaily.groupBy({
      by: ["key"],
      where: { ...where, kind: "FILTER" },
      _sum: { count: true },
      orderBy: { _sum: { count: "desc" } },
      take: TOP,
    }),
    db.analyticsUsageDaily.groupBy({
      by: ["key", "value"],
      where: { ...where, kind: "FILTER" },
      _sum: { count: true },
      orderBy: { _sum: { count: "desc" } },
      take: TOP,
    }),
    db.analyticsCollectionDaily.groupBy({
      by: ["collectionId"],
      where: { ...where, views: { gt: 0 } },
      _sum: { views: true },
      orderBy: { _sum: { views: "desc" } },
      take: TOP,
    }),
  ]);

  const products = await lookupProducts(ctx.engine, shopId, [
    ...productClicks.map((r) => r.productId),
    ...topBuy.map((r) => r.productId),
  ]);
  const collections = await lookupCollections(
    ctx.engine,
    shopId,
    topCol.map((r) => r.collectionId),
  );
  const label = await filterLabels(ctx);

  const byDay = new Map(daysIn(range).map((d) => [d, zero()]));
  const at = (d: Date) => byDay.get(dayOf(d));
  for (const r of named) {
    const v = at(r.date);
    if (v) {
      v.searches += num(r._sum.searches);
      v.zeroResults += num(r._sum.zeroResults);
    }
  }
  for (const r of allClicks) {
    const v = at(r.date);
    if (v) v.clicks += num(r._sum.clicks);
  }
  for (const r of filters) {
    const v = at(r.date);
    if (v) v.filtersApplied += num(r._sum.count);
  }
  for (const r of bought) {
    const v = at(r.date);
    if (v) v.boughtValue += num(r._sum.revenue);
  }
  // Giá trị sản phẩm được click = số click × giá hiện tại (currency gốc).
  for (const r of productClicks) {
    const v = at(r.date);
    const price = products.get(r.productId)?.price ?? 0;
    if (v) v.clickedValue += num(r._sum.clicks) * fromMinorUnits(price, ctx.currency);
  }

  const series = [...byDay].map(([date, values]) => ({
    date,
    values: {
      ...values,
      clickedValue: money(values.clickedValue),
      boughtValue: money(values.boughtValue),
    },
  }));
  const totals = zero();
  for (const s of series) for (const k of METRICS) totals[k] += s.values[k];
  totals.clickedValue = money(totals.clickedValue);
  totals.boughtValue = money(totals.boughtValue);

  const ref = (id: string): ProductRef => {
    const p = products.get(id)!;
    return { id: p.id, title: p.title, image: p.image, handle: p.handle };
  };
  return {
    totals,
    series,
    topQueries: topQ.map((r) => ({ query: r.query, searches: num(r._sum.searches) })),
    topClicked: topClick.map((r) => ({ ...ref(r.productId), clicks: num(r._sum.clicks) })),
    topZero: topZ.map((r) => ({ query: r.query, count: num(r._sum.zeroResults) })),
    topBought: topBuy.map((r) => ({ ...ref(r.productId), purchases: num(r._sum.purchases) })),
    topFilters: fUsage.map((r) => ({ filter: label(r.key), count: num(r._sum.count) })),
    topFilterValues: fvUsage.map((r) => ({
      filter: label(r.key),
      value: r.value,
      count: num(r._sum.count),
    })),
    topCollections: topCol.map((r) => ({
      id: r.collectionId,
      title: collections.get(r.collectionId) ?? r.collectionId,
      views: num(r._sum.views),
    })),
  };
}

// ---------- báo cáo dạng bảng ----------

const ratio = (a: number, b: number) => (b ? Math.min(1, a / b) : 0);

export async function getTable(ctx: Ctx, key: ReportKey, range: DateRange): Promise<Table> {
  const { db, shopId } = ctx;
  const where = { shopId, date: rangeBounds(range) };
  switch (key) {
    case "search-queries": {
      const rows = await db.analyticsDaily.groupBy({
        by: ["query"],
        where: { ...where, query: { not: "" }, searches: { gt: 0 } },
        _sum: {
          searches: true,
          clicks: true,
          productsBought: true,
          revenueShopCurrency: true,
          orders: true,
        },
      });
      const total = rows.reduce((n, r) => n + num(r._sum.searches), 0);
      return {
        columns: [
          { key: "query", kind: "text" },
          { key: "searches", kind: "number" },
          { key: "share", kind: "percent" },
          { key: "productsBought", kind: "number" },
          { key: "revenue", kind: "money" },
          { key: "ctr", kind: "percent" },
          { key: "cr", kind: "percent" },
        ],
        rows: rows.map((r) => {
          const searches = num(r._sum.searches);
          return {
            query: r.query,
            searches,
            share: ratio(searches, total),
            productsBought: num(r._sum.productsBought),
            revenue: money(r._sum.revenueShopCurrency),
            ctr: ratio(num(r._sum.clicks), searches),
            cr: ratio(num(r._sum.orders), searches),
          };
        }),
      };
    }
    case "search-zero": {
      const rows = await db.analyticsDaily.groupBy({
        by: ["query"],
        where: { ...where, query: { not: "" }, zeroResults: { gt: 0 } },
        _sum: { zeroResults: true },
      });
      return {
        columns: [
          { key: "query", kind: "text" },
          { key: "zeroResults", kind: "number" },
        ],
        rows: rows.map((r) => ({ query: r.query, zeroResults: num(r._sum.zeroResults) })),
      };
    }
    case "search-suggestions": {
      const rows = await db.analyticsUsageDaily.groupBy({
        by: ["key", "value"],
        where: { ...where, kind: "SUGGESTION" },
        _sum: { count: true },
      });
      return {
        columns: [
          { key: "query", kind: "text" },
          { key: "suggestion", kind: "text" },
          { key: "clicks", kind: "number" },
        ],
        rows: rows.map((r) => ({ query: r.key, suggestion: r.value, clicks: num(r._sum.count) })),
      };
    }
    case "search-products": {
      const rows = await db.analyticsProductDaily.groupBy({
        by: ["productId"],
        where,
        _sum: {
          searchClicks: true,
          collectionClicks: true,
          addToCarts: true,
          purchases: true,
          revenue: true,
        },
      });
      const products = await lookupProducts(
        ctx.engine,
        shopId,
        rows.map((r) => r.productId),
      );
      return {
        columns: [
          { key: "product", kind: "product" },
          { key: "searchClicks", kind: "number" },
          { key: "collectionClicks", kind: "number" },
          { key: "addToCarts", kind: "number" },
          { key: "purchases", kind: "number" },
          { key: "revenue", kind: "money" },
        ],
        rows: rows.map((r) => {
          const p = products.get(r.productId)!;
          return {
            product: p.title,
            _image: p.image,
            productId: r.productId,
            searchClicks: num(r._sum.searchClicks),
            collectionClicks: num(r._sum.collectionClicks),
            addToCarts: num(r._sum.addToCarts),
            purchases: num(r._sum.purchases),
            revenue: money(r._sum.revenue),
          };
        }),
      };
    }
    case "search-sorts": {
      const rows = await db.analyticsUsageDaily.groupBy({
        by: ["key"],
        where: { ...where, kind: "SORT" },
        _sum: { count: true },
      });
      const config = await loadShopConfig(db, shopId);
      const labels = new Map<string, string>(
        config.sortOptions.map((o) => [o.key, labelFor(o.label, ctx.locale, o.key)]),
      );
      const total = rows.reduce((n, r) => n + num(r._sum.count), 0);
      return {
        columns: [
          { key: "sort", kind: "text" },
          { key: "uses", kind: "number" },
          { key: "share", kind: "percent" },
        ],
        rows: rows.map((r) => ({
          sort: labels.get(r.key) ?? r.key,
          uses: num(r._sum.count),
          share: ratio(num(r._sum.count), total),
        })),
      };
    }
    case "collections": {
      const rows = await db.analyticsCollectionDaily.groupBy({
        by: ["collectionId"],
        where,
        _sum: { views: true, clicks: true, purchases: true, orders: true, revenue: true },
      });
      const titles = await lookupCollections(
        ctx.engine,
        shopId,
        rows.map((r) => r.collectionId),
      );
      return {
        columns: [
          { key: "collection", kind: "text" },
          { key: "views", kind: "number" },
          { key: "clicks", kind: "number" },
          { key: "purchases", kind: "number" },
          { key: "cr", kind: "percent" },
          { key: "revenue", kind: "money" },
        ],
        rows: rows.map((r) => ({
          collection: titles.get(r.collectionId) ?? r.collectionId,
          views: num(r._sum.views),
          clicks: num(r._sum.clicks),
          purchases: num(r._sum.purchases),
          cr: ratio(num(r._sum.orders), num(r._sum.views)),
          revenue: money(r._sum.revenue),
        })),
      };
    }
    default:
      return filterTable(ctx, key, where);
  }
}

/** Filter / giá trị / tổ hợp — trang search (scope "search") hoặc collection (scope = id collection). */
async function filterTable(
  ctx: Ctx,
  key: ReportKey,
  where: { shopId: string; date: ReturnType<typeof rangeBounds> },
): Promise<Table> {
  const search = key.startsWith("search-");
  const scope = search ? { scope: "search" } : { scope: { notIn: ["", "search"] } };
  const kind = key.endsWith("combos") ? "FILTER_COMBO" : "FILTER";
  const byValue = key.endsWith("values");
  const by = (
    search
      ? byValue
        ? ["key", "value"]
        : ["key"]
      : byValue
        ? ["scope", "key", "value"]
        : ["scope", "key"]
  ) as ("scope" | "key" | "value")[];
  const rows = await ctx.db.analyticsUsageDaily.groupBy({
    by,
    where: { ...where, ...scope, kind },
    _sum: { count: true },
  });
  const label = await filterLabels(ctx);
  const titles = search
    ? new Map<string, string>()
    : await lookupCollections(
        ctx.engine,
        ctx.shopId,
        rows.map((r) => (r as { scope: string }).scope),
      );
  const total = rows.reduce((n, r) => n + num(r._sum.count), 0);
  const collectionCol: Column[] = search ? [] : [{ key: "collection", kind: "text" }];
  const first: Column[] =
    kind === "FILTER_COMBO"
      ? [{ key: "combination", kind: "text" }]
      : [
          { key: "filter", kind: "text" },
          ...(byValue ? [{ key: "value", kind: "text" } as Column] : []),
        ];
  return {
    columns: [
      ...collectionCol,
      ...first,
      { key: "uses", kind: "number" },
      { key: "share", kind: "percent" },
    ],
    rows: rows.map((r) => {
      const g = r as {
        scope?: string;
        key: string;
        value?: string;
        _sum: { count: number | null };
      };
      return {
        ...(search ? {} : { collection: titles.get(g.scope ?? "") ?? g.scope ?? "" }),
        ...(kind === "FILTER_COMBO"
          ? { combination: comboLabel(g.key, label) }
          : { filter: label(g.key), ...(byValue ? { value: g.value ?? "" } : {}) }),
        uses: num(g._sum.count),
        share: ratio(num(g._sum.count), total),
      };
    }),
  };
}

// ---------- tìm / sắp xếp / phân trang, CSV ----------

export const PAGE_SIZE = 25;

export function pageRows(
  table: Table,
  opts: { q?: string; sort?: string; dir?: "asc" | "desc"; page?: number },
) {
  const text = table.columns.find((c) => c.kind === "text" || c.kind === "product")?.key;
  const q = opts.q?.trim().toLowerCase();
  let rows =
    q && text
      ? table.rows.filter((r) =>
          String(r[text] ?? "")
            .toLowerCase()
            .includes(q),
        )
      : table.rows;
  const firstNumber = table.columns.find((c) => c.kind !== "text" && c.kind !== "product")?.key;
  const sort = table.columns.some((c) => c.key === opts.sort)
    ? opts.sort!
    : (firstNumber ?? text ?? "");
  const dir = opts.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const x = a[sort];
    const y = b[sort];
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x ?? "").localeCompare(String(y ?? "")) * dir;
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(opts.page ?? 1)));
  return {
    columns: table.columns,
    rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: rows.length,
    page,
    pages,
    sort,
    dir: dir === 1 ? ("asc" as const) : ("desc" as const),
  };
}

/** CSV (RFC 4180) với tiêu đề cột đã dịch; chặn công thức Excel (=, +, -, @) ở ô chữ. */
export function csvOf(table: Table, headers: Record<string, string>): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [table.columns.map((c) => cell(headers[c.key] ?? c.key)).join(",")];
  for (const r of table.rows)
    lines.push(
      table.columns
        .map((c) =>
          c.kind === "percent" ? cell(Math.round(num(r[c.key]) * 10_000) / 100) : cell(r[c.key]),
        )
        .join(","),
    );
  return lines.join("\r\n") + "\r\n";
}

/** Một trang báo cáo (Search / Collections): tab, ô tìm, sắp xếp, trang — đọc từ URL. */
export async function reportPage(ctx: Ctx, url: URL, tabs: Record<string, ReportKey>) {
  const params = url.searchParams;
  const asked = params.get("tab") ?? "";
  const tab = asked in tabs ? asked : Object.keys(tabs)[0];
  const q = params.get("q") ?? "";
  const table = pageRows(await getTable(ctx, tabs[tab], parseDateRange(params)), {
    q,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    page: Number(params.get("page") ?? 1),
  });
  return { tab, q, table };
}
