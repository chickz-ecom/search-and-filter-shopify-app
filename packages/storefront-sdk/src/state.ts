import type { Filters, PublicFilter, UrlState } from "./types";

// Đồng bộ URL (mục 6.4a): q, filter.p.* / filter.v.* (giống hệt filter native của Shopify → fallback dùng chung URL),
// sort_by, page. Giá trong URL là currency khách đang xem.

export function readState(search: string, filters: PublicFilter[]): UrlState {
  const p = new URLSearchParams(search);
  const out: UrlState = { filters: {} };
  const q = p.get("q");
  if (q) out.q = q;
  const sort = p.get("sort_by");
  if (sort) out.sort = sort;
  const page = Number(p.get("page"));
  if (page > 1) out.page = page;
  for (const f of filters) {
    if (f.type === "range") {
      const min = p.get(`${f.param}.gte`);
      const max = p.get(`${f.param}.lte`);
      if (min !== null || max !== null) {
        out.filters[f.id] = {
          ...(min !== null && min !== "" ? { min: Number(min) } : {}),
          ...(max !== null && max !== "" ? { max: Number(max) } : {}),
        };
      }
    } else if (f.type === "toggle" && (f.source === "availability" || f.source === "on_sale")) {
      const v = p.get(f.param);
      if (v === "1") out.filters[f.id] = true;
    } else {
      const vs = p.getAll(f.param);
      if (vs.length) out.filters[f.id] = vs;
    }
  }
  return out;
}

export function writeState(state: UrlState, filters: PublicFilter[], base: string): string {
  const p = new URLSearchParams(base);
  for (const f of filters) {
    p.delete(f.param);
    p.delete(`${f.param}.gte`);
    p.delete(`${f.param}.lte`);
  }
  ["q", "sort_by", "page"].forEach((k) => p.delete(k));
  if (state.q) p.set("q", state.q);
  for (const f of filters) {
    const v = (state.filters as Filters)[f.id];
    if (v === undefined) continue;
    if (typeof v === "boolean") {
      if (v) p.set(f.param, "1");
    } else if (Array.isArray(v)) v.forEach((x) => p.append(f.param, x));
    else {
      if (v.min !== undefined) p.set(`${f.param}.gte`, String(v.min));
      if (v.max !== undefined) p.set(`${f.param}.lte`, String(v.max));
    }
  }
  if (state.sort) p.set("sort_by", state.sort);
  if (state.page && state.page > 1) p.set("page", String(state.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
