import { metafieldDocField } from "../../config/search-fields";
import {
  isMetafieldSortKey,
  parseMetafieldSortKey,
  sortKeyFromCollectionSortOrder,
  visibleSortOptions,
  type SortKey,
  type SortOptionConfig,
  type TieBreak,
} from "../../config/sort-options";

// Sort builder từ SortOption / SortDefault (task 2.3, bảng 4.4). Typesense cho tối đa 3 trường sort.

export type SortContext = {
  hasQuery: boolean;
  /** ID số của collection khi ở trang collection. */
  collectionId?: string;
  showOutOfStock: "SHOW" | "HIDE" | "PUSH_DOWN";
  tieBreak: TieBreak;
  /** Country có giá cố định trong index (`price_min_{CC}`) — phương án B, chỉ khi flag bật. */
  fixedPriceCountry?: string;
};

const MISSING_LAST = "(missing_values: last)";

function tieBreakTerm(t: TieBreak): string {
  return t === "best_selling" ? `best_selling_rank${MISSING_LAST}:asc` : "published_at:desc";
}

/** Câu sort chính cho một key; null nếu key không áp dụng được trong ngữ cảnh này. */
export function mainSortTerm(key: SortKey, ctx: SortContext): string | null {
  const priceField = ctx.fixedPriceCountry
    ? `price_min_${ctx.fixedPriceCountry.toLowerCase()}`
    : "price_min";
  const priceTerm = (dir: "asc" | "desc") =>
    ctx.fixedPriceCountry ? `${priceField}${MISSING_LAST}:${dir}` : `${priceField}:${dir}`;
  switch (key) {
    case "relevance":
      return ctx.hasQuery ? "_text_match:desc" : null;
    case "manual":
      return ctx.collectionId ? `pos_${ctx.collectionId}${MISSING_LAST}:asc` : null;
    case "best_selling":
      return `best_selling_rank${MISSING_LAST}:asc`;
    case "price_asc":
      return priceTerm("asc");
    case "price_desc":
      return priceTerm("desc");
    case "created_desc":
      return "published_at:desc";
    case "created_asc":
      return "published_at:asc";
    case "title_asc":
      return "title_sort:asc";
    case "title_desc":
      return "title_sort:desc";
    case "discount_desc":
      return "discount_pct:desc";
    default: {
      if (isMetafieldSortKey(key)) {
        const { namespace, key: k, direction } = parseMetafieldSortKey(key);
        return `${metafieldDocField(namespace, k)}${MISSING_LAST}:${direction}`;
      }
      return null;
    }
  }
}

/**
 * Ghép tối đa 3 trường: (1) đẩy hết hàng xuống nếu bật, (2) sort chính, (3) tie-break.
 * Key không áp dụng được (relevance khi không có q, manual ngoài collection) → dùng tie-break làm sort chính.
 */
export function buildSortBy(key: SortKey, ctx: SortContext): string {
  const terms: string[] = [];
  if (ctx.showOutOfStock === "PUSH_DOWN") terms.push("_eval(available:true):desc");
  const main = mainSortTerm(key, ctx) ?? tieBreakTerm(ctx.tieBreak);
  terms.push(main);
  const tie =
    key === "relevance" || !ctx.hasQuery ? tieBreakTerm(ctx.tieBreak) : "_text_match:desc";
  if (tie !== main) terms.push(tie);
  if (!terms.some((t) => t.startsWith("_text_match")) && terms.length < 3 && ctx.hasQuery) {
    terms.push("_text_match:desc");
  }
  return terms.slice(0, 3).join(",");
}

export type SortDefaults = {
  search?: SortKey;
  collectionDefault?: SortKey;
  /** Ghi đè theo collection: collectionId → key. */
  collections?: Record<string, SortKey>;
};

/**
 * Chọn sort key: key khách yêu cầu (nếu đang bật và hợp ngữ cảnh) → mặc định.
 * Mặc định collection: ghi đè theo collection → mặc định chung cho collection → sortOrder của Shopify.
 */
export function resolveSortKey(
  requested: string | null | undefined,
  options: SortOptionConfig[],
  defaults: SortDefaults,
  ctx: { hasQuery: boolean; collectionId?: string; collectionSortOrder?: string | null },
): SortKey {
  const isCollection = Boolean(ctx.collectionId);
  const visible = visibleSortOptions(options, { hasQuery: ctx.hasQuery, isCollection });
  const allowed = new Set<string>(visible.map((o) => o.key));
  if (requested && allowed.has(requested)) return requested as SortKey;

  const candidates: (SortKey | undefined)[] = isCollection
    ? [
        ctx.hasQuery ? "relevance" : undefined,
        ctx.collectionId ? defaults.collections?.[ctx.collectionId] : undefined,
        defaults.collectionDefault,
        sortKeyFromCollectionSortOrder(ctx.collectionSortOrder),
      ]
    : [
        ctx.hasQuery ? (defaults.search ?? "relevance") : undefined,
        defaults.search,
        "best_selling",
      ];

  for (const c of candidates) {
    if (c && allowed.has(c)) return c;
  }
  // Mặc định không bật → vẫn trả về mặc định hợp ngữ cảnh (không phụ thuộc option bật/tắt).
  for (const c of candidates) {
    if (
      c &&
      mainSortTerm(c, {
        hasQuery: ctx.hasQuery,
        collectionId: ctx.collectionId,
        showOutOfStock: "SHOW",
        tieBreak: "best_selling",
      })
    ) {
      return c;
    }
  }
  return visible[0]?.key ?? "best_selling";
}
