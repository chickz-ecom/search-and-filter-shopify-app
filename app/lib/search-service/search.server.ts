import type { FilterItem } from "../config/filters";
import { collectionOverrideTag } from "../merch/engine-sync.server";
import type { SearchEngine, SearchParams, SearchResult } from "../search/engine";
import type { ProductDoc } from "../search/product-doc";
import { buildFacets, facetFields, maxFacetValues, type Facet } from "../search/query/facets";
import {
  baseFilterClauses,
  buildFilterBy,
  disjunctiveGroups,
  urlParamFor,
  type AppliedFilters,
  type FilterContext,
} from "../search/query/filters";
import { buildSortBy, resolveSortKey } from "../search/query/sort";
import { facetFieldFor } from "../config/filters";
import { sortKeyFromCollectionSortOrder } from "../config/sort-options";
import { buildTextQuery, normalizeQuery, queryKey } from "../search/query/text-query";
import {
  fixedPriceMarket,
  localizedSortOptions,
  stopwordsFor,
  type ShopSearchContext,
} from "./context.server";

// Pipeline search (mục 6.1): chuẩn hoá → redirect → query_by/weights → stopword+synonym → merch → hết hàng
// → sort → facet. Response trả giá GỐC (currency của shop) — giá hiển thị do SDK lấy từ Storefront API (D15).

export type SearchRequest = {
  q?: string | null;
  page?: number;
  perPage?: number;
  sort?: string | null;
  locale: string;
  country?: string | null;
  filters: AppliedFilters;
  /** Trang collection. */
  collection?: { id: string; handle: string; sortOrder?: string | null } | null;
  fields?: string[];
};

export type ProductResult = {
  id: string;
  gid: string;
  handle: string;
  url: string;
  title: string;
  vendor: string;
  product_type: string;
  image?: string;
  image_alt?: string;
  image_2?: string;
  available: boolean;
  price_min: number;
  price_max: number;
  compare_at_max?: number;
  discount_pct: number;
  on_sale: boolean;
  currency: string;
  tags: string[];
  variants: unknown[];
  badges: string[];
};

export type SearchResponseBody = {
  query: string;
  corrected_query: string | null;
  redirect: string | null;
  total: number;
  page: number;
  per_page: number;
  sort: string;
  sort_options: { key: string; label: string }[];
  products: Partial<ProductResult>[];
  facets: Facet[];
  applied_filters: AppliedFilters;
  currency: string;
  /** Rule merch đã áp (debug cho admin "Thử tìm"). */
  took_ms: number;
};

export const MAX_PER_PAGE = 48;

const PRODUCT_FIELDS: (keyof ProductResult)[] = [
  "id",
  "gid",
  "handle",
  "url",
  "title",
  "vendor",
  "product_type",
  "image",
  "image_alt",
  "image_2",
  "available",
  "price_min",
  "price_max",
  "compare_at_max",
  "discount_pct",
  "on_sale",
  "currency",
  "tags",
  "variants",
  "badges",
];

export function toProductResult(
  doc: ProductDoc,
  currency: string,
  priceField?: string,
  fields?: string[],
): Partial<ProductResult> {
  const priceMin =
    priceField && typeof doc[priceField as `price_min_${string}`] === "number"
      ? (doc[priceField as `price_min_${string}`] as number)
      : doc.price_min;
  const badges: string[] = [];
  if (doc.on_sale) badges.push("sale");
  if (!doc.available) badges.push("sold_out");
  let variants: unknown[] = [];
  try {
    variants = JSON.parse(doc.variants_json || "[]");
  } catch {
    variants = [];
  }
  const full: ProductResult = {
    id: doc.id,
    gid: doc.gid,
    handle: doc.handle,
    url: `/products/${doc.handle}`,
    title: doc.title,
    vendor: doc.vendor,
    product_type: doc.product_type,
    image: doc.image,
    image_alt: doc.image_alt,
    image_2: doc.image_2,
    available: doc.available,
    price_min: priceMin,
    price_max: priceField ? Math.max(priceMin, doc.price_max) : doc.price_max,
    compare_at_max: doc.compare_at_max,
    discount_pct: doc.discount_pct,
    on_sale: doc.on_sale,
    currency,
    tags: doc.tags,
    variants,
    badges,
  };
  if (!fields?.length) return full;
  const allowed = new Set(
    fields.filter((f) => (PRODUCT_FIELDS as string[]).includes(f)).concat(["id", "gid"]),
  );
  return Object.fromEntries(
    Object.entries(full).filter(([k]) => allowed.has(k)),
  ) as Partial<ProductResult>;
}

export function filtersForScope(ctx: ShopSearchContext, collectionId?: string): FilterItem[] {
  if (collectionId && ctx.filters.collections[collectionId])
    return ctx.filters.collections[collectionId];
  if (!collectionId && ctx.filters.search) return ctx.filters.search;
  return ctx.filters.default;
}

/** Dựng tham số engine (dùng chung cho search-api và ô "Thử tìm" của admin). */
export function planSearch(ctx: ShopSearchContext, req: SearchRequest) {
  const q = normalizeQuery(req.q);
  const isCollection = Boolean(req.collection);
  const items = filtersForScope(ctx, req.collection?.id).filter((i) => i.enabled);
  // Field động (opt_*, pos_*, price_min_*) chỉ có trong schema khi đã có document mang nó; facet/filter/sort
  // trên field chưa có làm Typesense báo lỗi (đã đo) → kiểm tra trước.
  const indexed = ctx.indexedFields.length ? new Set(ctx.indexedFields) : undefined;
  const has = (f: string) => !indexed || indexed.has(f);
  const fixed = fixedPriceMarket(ctx, req.country);
  const market = fixed && has(`price_min_${req.country!.toLowerCase()}`) ? fixed : undefined;
  const priceField = market ? `price_min_${req.country!.toLowerCase()}` : "price_min";
  const priceCurrency = market ? market.currency : ctx.shop.currency;
  const fctx: FilterContext = { shopCurrency: ctx.shop.currency, priceField, priceCurrency };
  let sortKey = resolveSortKey(req.sort, ctx.sortOptions, ctx.sortDefaults, {
    hasQuery: Boolean(q),
    collectionId: req.collection?.id,
    collectionSortOrder: req.collection?.sortOrder,
  });
  if (sortKey === "manual" && req.collection && !has(`pos_${req.collection.id}`)) {
    // Chưa có vị trí thủ công nào (collection mới / vượt ngân sách pos_) → sort mặc định khác MANUAL.
    const fallback = sortKeyFromCollectionSortOrder(req.collection.sortOrder);
    sortKey = fallback === "manual" ? "best_selling" : fallback;
  }
  const impossible = items.some((i) => {
    const v = req.filters[i.id];
    if (v === undefined) return false;
    const field = i.source === "price" ? priceField : facetFieldFor(i);
    return !has(field) && !(typeof v === "boolean" && i.source === "availability" && !v);
  });
  const text = buildTextQuery(ctx.settings, {
    locale: req.locale,
    primaryLocale: ctx.shop.primaryLocale,
    indexedLocales: ctx.shop.locales.filter((l) => l !== ctx.shop.primaryLocale),
    indexedFields: indexed,
    mode: "search",
  });
  const base = baseFilterClauses({
    collectionId: req.collection?.id,
    excludeTags: ctx.settings.excludeTags,
    hideOutOfStock: ctx.settings.showOutOfStock === "HIDE",
  });
  const page = Math.max(1, Math.min(1000, Math.floor(req.page ?? 1)));
  const perPage = Math.max(1, Math.min(MAX_PER_PAGE, Math.floor(req.perPage ?? 24)));
  const sortBy = buildSortBy(sortKey, {
    hasQuery: Boolean(q),
    collectionId: req.collection?.id,
    showOutOfStock: ctx.settings.showOutOfStock,
    tieBreak: ctx.settings.relevanceTieBreak,
    fixedPriceCountry: market ? req.country! : undefined,
  });
  const facetBy = facetFields(items, priceField).filter(has);
  const common: Omit<SearchParams, "filterBy" | "facetBy"> = {
    q: q || "*",
    ...text,
    stopwords: q ? stopwordsFor(ctx, req.locale) : undefined,
    curationTags: isCollection ? [collectionOverrideTag(req.collection!.id)] : undefined,
    maxFacetValues: maxFacetValues(items),
    searchCutoffMs: 400,
  };
  const main: SearchParams = {
    ...common,
    filterBy: buildFilterBy(req.filters, items, fctx, base) || undefined,
    facetBy,
    sortBy,
    page,
    perPage,
    excludeFields: [
      "description_text",
      "collection_titles",
      "option_values",
      "variant_titles",
      "barcodes",
      "skus",
    ],
  };
  const groups = disjunctiveGroups(req.filters, items);
  const disjunctive = groups.map((g) => ({
    id: g.id,
    params: {
      ...common,
      filterBy: buildFilterBy(req.filters, items, fctx, base, g.id) || undefined,
      facetBy: facetFields([g], priceField).filter(has),
      perPage: 0,
    } satisfies SearchParams,
  }));
  return {
    q,
    key: queryKey(q),
    items,
    main,
    disjunctive,
    sortKey,
    priceField,
    priceCurrency,
    market,
    page,
    perPage,
    impossible,
  };
}

export async function executeSearch(
  ctx: ShopSearchContext,
  req: SearchRequest,
  engine: SearchEngine,
): Promise<SearchResponseBody> {
  const t0 = Date.now();
  const plan = planSearch(ctx, req);
  const sortOptions = localizedSortOptions(ctx, req.locale).filter(
    (o) => (req.collection || o.key !== "manual") && (plan.q || o.key !== "relevance"),
  );
  const empty = (redirect: string | null): SearchResponseBody => ({
    query: plan.q,
    corrected_query: null,
    redirect,
    total: 0,
    page: plan.page,
    per_page: plan.perPage,
    sort: plan.sortKey,
    sort_options: sortOptions,
    products: [],
    facets: [],
    applied_filters: req.filters,
    currency: plan.priceCurrency,
    took_ms: Date.now() - t0,
  });
  if (!req.collection && plan.key && ctx.redirects[plan.key]) return empty(ctx.redirects[plan.key]);
  // Lọc theo field chưa có trong index (vd. option không sản phẩm nào có) → chắc chắn 0 kết quả.
  if (plan.impossible) return empty(null);

  const results = await engine.multiSearch<ProductDoc>([
    { collection: ctx.productIndex, params: plan.main },
    ...plan.disjunctive.map((d) => ({ collection: ctx.productIndex, params: d.params })),
  ]);
  const [main, ...rest] = results as SearchResult<ProductDoc>[];
  const disjunctive = Object.fromEntries(
    plan.disjunctive.map((d, i) => [d.id, rest[i]?.facets ?? []]),
  );
  const facets = buildFacets(plan.items, main.facets, disjunctive, req.filters, {
    locale: req.locale,
    priceField: plan.priceField,
    currency: plan.priceCurrency,
    paramFor: urlParamFor,
  });
  return {
    query: plan.q,
    corrected_query: null,
    redirect: null,
    total: main.found,
    page: plan.page,
    per_page: plan.perPage,
    sort: plan.sortKey,
    sort_options: sortOptions,
    products: main.hits.map((h) =>
      toProductResult(
        h.document,
        plan.priceCurrency,
        plan.market ? plan.priceField : undefined,
        req.fields,
      ),
    ),
    facets,
    applied_filters: req.filters,
    currency: plan.priceCurrency,
    took_ms: Date.now() - t0,
  };
}
