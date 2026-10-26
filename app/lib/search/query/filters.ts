import { facetFieldFor, optionDocField, type FilterItem } from "../../config/filters";
import { toMinorUnits } from "./currency";

// Bộ dịch filter (task 2.4): tham số URL kiểu Shopify (`filter.p.*` / `filter.v.*`) ↔ `filter_by`.
// URL giống hệt filter native của Shopify → khi engine lỗi, cùng URL vẫn lọc được bằng native (D11).

export type RangeValue = { min?: number; max?: number };
/** Filter đã áp dụng theo FilterItem.id. Range: giá trị currency gốc của shop, đơn vị chính (19.99). */
export type AppliedFilters = Record<string, string[] | RangeValue | boolean>;

/** Tham số URL của Shopify native cho một filter item. */
export function urlParamFor(item: FilterItem): string {
  switch (item.source) {
    case "vendor":
      return "filter.p.vendor";
    case "product_type":
      return "filter.p.product_type";
    case "tags":
      return "filter.p.tag";
    case "collection":
      return "filter.p.collection";
    case "price":
      return "filter.v.price";
    case "availability":
      return "filter.v.availability";
    case "on_sale":
      return "filter.p.on_sale";
    case "option":
      return `filter.v.option.${(item.optionName ?? "").toLowerCase()}`;
    case "metafield":
      return `filter.p.m.${item.metafield}`;
  }
}

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function getAll(src: ParamSource, key: string): string[] {
  if (src instanceof URLSearchParams) return src.getAll(key);
  const v = src[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Đọc filter từ URL theo cây filter đang bật. Tham số lạ bị bỏ qua. */
export function parseFilterParams(src: ParamSource, items: FilterItem[]): AppliedFilters {
  const out: AppliedFilters = {};
  for (const item of items) {
    if (!item.enabled) continue;
    const param = urlParamFor(item);
    if (item.display === "range") {
      const min = num(getAll(src, `${param}.gte`)[0]);
      const max = num(getAll(src, `${param}.lte`)[0]);
      if (min !== undefined || max !== undefined) out[item.id] = { min, max };
      continue;
    }
    if (item.source === "availability" || item.source === "on_sale") {
      const v = getAll(src, param)[0];
      if (v === "1" || v === "true") out[item.id] = true;
      else if (v === "0" || v === "false") out[item.id] = false;
      continue;
    }
    const values = getAll(src, param)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (values.length) out[item.id] = [...new Set(values)];
  }
  return out;
}

/** Ghi filter ra URLSearchParams (SDK đồng bộ URL). */
export function serializeFilterParams(
  applied: AppliedFilters,
  items: FilterItem[],
  into = new URLSearchParams(),
) {
  for (const item of items) {
    const v = applied[item.id];
    if (v === undefined) continue;
    const param = urlParamFor(item);
    if (typeof v === "boolean") into.set(param, v ? "1" : "0");
    else if (Array.isArray(v)) v.forEach((x) => into.append(param, x));
    else {
      if (v.min !== undefined) into.set(`${param}.gte`, String(v.min));
      if (v.max !== undefined) into.set(`${param}.lte`, String(v.max));
    }
  }
  return into;
}

/** Escape giá trị string trong filter_by của Typesense (bọc backtick, bỏ backtick bên trong). */
export function quote(v: string): string {
  return "`" + v.replace(/`/g, "") + "`";
}

export type FilterContext = {
  shopCurrency: string;
  /** Field giá dùng cho filter (price_min hoặc price_min_{cc} khi market có giá cố định). */
  priceField?: string;
  /** Currency của priceField (currency market khi dùng price_min_{cc}). */
  priceCurrency?: string;
};

/** Một nhóm filter → mệnh đề filter_by; null nếu không áp dụng. */
export function clauseFor(
  item: FilterItem,
  value: AppliedFilters[string],
  ctx: FilterContext,
): string | null {
  const field = item.source === "price" ? (ctx.priceField ?? "price_min") : facetFieldFor(item);
  if (typeof value === "boolean") {
    if (item.source === "availability") return value ? "available:=true" : null;
    return `${field}:=${value}`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return null;
    if (item.matchAll) return value.map((v) => `${field}:=${quote(v)}`).join(" && ");
    return `${field}:=[${value.map(quote).join(",")}]`;
  }
  const currency = item.source === "price" ? (ctx.priceCurrency ?? ctx.shopCurrency) : null;
  const conv = (n: number) => (currency ? toMinorUnits(n, currency) : n);
  const parts: string[] = [];
  if (value.min !== undefined) parts.push(`${field}:>=${conv(value.min)}`);
  if (value.max !== undefined) parts.push(`${field}:<=${conv(value.max)}`);
  if (!parts.length) return null;
  // Giá của sản phẩm là khoảng [price_min, price_max]: lọc theo price_min là cách Shopify native làm.
  return parts.join(" && ");
}

export type BaseFilterInput = {
  collectionId?: string;
  excludeTags?: string[];
  hideOutOfStock?: boolean;
  /** Merch: ẩn sản phẩm (id). */
  hiddenIds?: string[];
};

export function baseFilterClauses(input: BaseFilterInput): string[] {
  const out: string[] = [];
  if (input.collectionId) out.push(`collections:=${quote(input.collectionId)}`);
  if (input.excludeTags?.length) out.push(`tags:!=[${input.excludeTags.map(quote).join(",")}]`);
  if (input.hideOutOfStock) out.push("available:=true");
  if (input.hiddenIds?.length) out.push(`id:!=[${input.hiddenIds.map(quote).join(",")}]`);
  return out;
}

/** filter_by đầy đủ; `exceptId` bỏ nhóm đó ra (đếm facet kiểu disjunctive). */
export function buildFilterBy(
  applied: AppliedFilters,
  items: FilterItem[],
  ctx: FilterContext,
  base: string[] = [],
  exceptId?: string,
): string {
  const clauses = [...base];
  for (const item of items) {
    if (item.id === exceptId) continue;
    const v = applied[item.id];
    if (v === undefined) continue;
    const c = clauseFor(item, v, ctx);
    if (c) clauses.push(c.includes("&&") ? `(${c})` : c);
  }
  return clauses.join(" && ");
}

/** Nhóm cần một query riêng để đếm facet (OR trong nhóm, đã có lựa chọn). */
export function disjunctiveGroups(applied: AppliedFilters, items: FilterItem[]): FilterItem[] {
  return items.filter((i) => {
    const v = applied[i.id];
    return Array.isArray(v) && v.length > 0 && !i.matchAll && i.display !== "range";
  });
}

export { optionDocField };
