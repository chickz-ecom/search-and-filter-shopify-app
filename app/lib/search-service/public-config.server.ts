import { labelFor } from "../config/sort-options";
import type { FilterItem } from "../config/filters";
import { urlParamFor } from "../search/query/filters";
import { localizedSortOptions, type ShopSearchContext } from "./context.server";

// GET /v1/config (mục 6.1): những gì SDK cần, không lộ gì nội bộ. Cache 5 phút; purge khi merchant lưu.

export const DEFAULT_TEXTS: Record<"en" | "vi", Record<string, string>> = {
  en: {
    placeholder: "Search products",
    noResults: "No results for “{q}”",
    noResultsHint: "Check the spelling or try a more general term.",
    viewAll: "View all {n} results",
    products: "Products",
    collections: "Collections",
    pages: "Pages",
    suggestions: "Suggestions",
    filters: "Filters",
    clearAll: "Clear all",
    apply: "Apply",
    sortBy: "Sort by",
    results: "{n} results",
    loadMore: "Load more",
    previous: "Previous",
    next: "Next",
    soldOut: "Sold out",
    sale: "Sale",
    from: "From {price}",
    viewPrice: "View price",
    min: "Min",
    max: "Max",
    inStock: "In stock",
  },
  vi: {
    placeholder: "Tìm sản phẩm",
    noResults: "Không có kết quả cho “{q}”",
    noResultsHint: "Kiểm tra chính tả hoặc thử từ khoá chung hơn.",
    viewAll: "Xem tất cả {n} kết quả",
    products: "Sản phẩm",
    collections: "Bộ sưu tập",
    pages: "Trang",
    suggestions: "Gợi ý",
    filters: "Bộ lọc",
    clearAll: "Xoá tất cả",
    apply: "Áp dụng",
    sortBy: "Sắp xếp",
    results: "{n} kết quả",
    loadMore: "Xem thêm",
    previous: "Trước",
    next: "Sau",
    soldOut: "Hết hàng",
    sale: "Giảm giá",
    from: "Từ {price}",
    viewPrice: "Xem giá",
    min: "Thấp nhất",
    max: "Cao nhất",
    inStock: "Còn hàng",
  },
};

export type PublicFilter = {
  id: string;
  label: string;
  type: FilterItem["display"];
  source: FilterItem["source"];
  param: string;
  collapsed: boolean;
  showCount: boolean;
};

export type PublicConfig = {
  version: string;
  locale: string;
  shop: { currency: string; primaryLocale: string; locales: string[] };
  searchTypes: ShopSearchContext["settings"]["searchTypes"];
  sortOptions: { key: string; label: string }[];
  sortDefaults: { search: string };
  filters: { default: PublicFilter[]; search: PublicFilter[] };
  texts: Record<string, string>;
  appearance: Record<string, unknown>;
  templates: Record<string, string>;
  /** Country có giá cố định trong index (phương án B) → SDK biết filter giá dùng currency nào. */
  fixedPriceCountries: string[];
  /** Country có điều chỉnh giá theo market → SDK luôn gọi Storefront API cho giá. */
  adjustedCountries: string[];
};

export function publicFilters(items: FilterItem[], locale: string): PublicFilter[] {
  return items
    .filter((i) => i.enabled)
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      id: i.id,
      label: labelFor(i.label, locale, i.id),
      type: i.display,
      source: i.source,
      param: urlParamFor(i),
      collapsed: i.collapsed,
      showCount: i.showCount,
    }));
}

export function buildPublicConfig(ctx: ShopSearchContext, locale: string): PublicConfig {
  const base = locale.toLowerCase().startsWith("vi") ? "vi" : "en";
  const overrides = (ctx.appearance.texts[locale] ?? ctx.appearance.texts[base] ?? {}) as Record<
    string,
    string
  >;
  return {
    version: ctx.version,
    locale,
    shop: {
      currency: ctx.shop.currency,
      primaryLocale: ctx.shop.primaryLocale,
      locales: ctx.shop.locales,
    },
    searchTypes: ctx.settings.searchTypes,
    sortOptions: localizedSortOptions(ctx, locale),
    sortDefaults: { search: ctx.sortDefaults.search ?? "relevance" },
    filters: {
      default: publicFilters(ctx.filters.default, locale),
      search: publicFilters(ctx.filters.search ?? ctx.filters.default, locale),
    },
    texts: { ...DEFAULT_TEXTS[base], ...overrides },
    appearance: ctx.appearance.tokens,
    templates: ctx.appearance.templates,
    fixedPriceCountries: ctx.features.fixedMarketPrices
      ? ctx.markets.filter((m) => m.hasFixedPrices).flatMap((m) => m.countries)
      : [],
    adjustedCountries: ctx.markets
      .filter((m) => m.hasFixedPrices || (m as { adjustmentPct?: number }).adjustmentPct)
      .flatMap((m) => m.countries),
  };
}
