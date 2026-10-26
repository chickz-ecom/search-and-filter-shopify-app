import { facetFieldFor, type FilterItem } from "../../config/filters";
import { labelFor } from "../../config/sort-options";
import type { FacetCount } from "../engine";
import type { AppliedFilters, RangeValue } from "./filters";

// Facet count + min/max giá (task 2.4). Response theo mục 6.1.

export type FacetValue = { value: string; label?: string; count: number; selected: boolean };

export type ListFacet = {
  key: string;
  label: string;
  type: "checkbox" | "radio" | "swatch" | "toggle";
  param: string;
  values: FacetValue[];
  collapsed: boolean;
  showCount: boolean;
};

export type RangeFacet = {
  key: string;
  label: string;
  type: "range";
  param: string;
  /** Minor units của `currency` (giá) hoặc giá trị thô (metafield số). */
  min: number;
  max: number;
  selected?: RangeValue;
  currency?: string;
  collapsed: boolean;
};

export type Facet = ListFacet | RangeFacet;

export function facetFields(items: FilterItem[], priceField = "price_min"): string[] {
  const fields = items
    .filter((i) => i.enabled)
    .map((i) => (i.source === "price" ? priceField : facetFieldFor(i)));
  return [...new Set(fields)];
}

export function maxFacetValues(items: FilterItem[]): number {
  return Math.min(250, Math.max(10, ...items.filter((i) => i.enabled).map((i) => i.maxValues)));
}

type BuildCtx = {
  locale: string;
  priceField?: string;
  currency: string;
  paramFor: (item: FilterItem) => string;
};

/**
 * Ghép facet từ kết quả chính + các query disjunctive (đếm khi bỏ lựa chọn của chính nhóm đó).
 * Nhóm không có giá trị nào (count 0, chưa chọn) bị ẩn để không hiện filter rỗng.
 */
export function buildFacets(
  items: FilterItem[],
  main: FacetCount[],
  disjunctive: Record<string, FacetCount[]>,
  applied: AppliedFilters,
  ctx: BuildCtx,
): Facet[] {
  const out: Facet[] = [];
  const sorted = items.filter((i) => i.enabled).sort((a, b) => a.position - b.position);
  for (const item of sorted) {
    const field = item.source === "price" ? (ctx.priceField ?? "price_min") : facetFieldFor(item);
    const source = disjunctive[item.id] ?? main;
    const counts = source.find((f) => f.field === field);
    const label = labelFor(item.label, ctx.locale, item.id);
    const param = ctx.paramFor(item);
    if (item.display === "range") {
      const stats = counts?.stats;
      if (stats?.min === undefined || stats?.max === undefined) continue;
      const sel = applied[item.id];
      out.push({
        key: item.id,
        label,
        type: "range",
        param,
        min: stats.min,
        max: stats.max,
        selected: sel && !Array.isArray(sel) && typeof sel === "object" ? sel : undefined,
        currency: item.source === "price" ? ctx.currency : undefined,
        collapsed: item.collapsed,
      });
      continue;
    }
    const selectedRaw = applied[item.id];
    const selected = new Set(
      Array.isArray(selectedRaw)
        ? selectedRaw
        : typeof selectedRaw === "boolean"
          ? [String(selectedRaw)]
          : [],
    );
    let values: FacetValue[] = (counts?.values ?? [])
      .filter((v) => !item.tagPrefix || v.value.startsWith(item.tagPrefix))
      .map((v) => ({
        value: v.value,
        label: item.tagPrefix ? v.value.slice(item.tagPrefix.length) : undefined,
        count: v.count,
        selected: selected.has(v.value),
      }));
    // Giá trị đã chọn nhưng không còn kết quả vẫn hiện (count 0) để khách bỏ chọn được.
    for (const s of selected) {
      if (!values.some((v) => v.value === s)) values.push({ value: s, count: 0, selected: true });
    }
    if (item.source === "availability" || item.source === "on_sale") {
      values = values.filter((v) => v.value === "true");
    }
    if (item.sortValues === "alpha") {
      values.sort((a, b) => (a.label ?? a.value).localeCompare(b.label ?? b.value, ctx.locale));
    } else {
      values.sort((a, b) => b.count - a.count);
    }
    values = values.slice(0, item.maxValues);
    if (!values.length) continue;
    out.push({
      key: item.id,
      label,
      type: item.display as ListFacet["type"],
      param,
      values,
      collapsed: item.collapsed,
      showCount: item.showCount,
    });
  }
  return out;
}
