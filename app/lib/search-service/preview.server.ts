import { EMBEDDING_FIELD } from "../search/index-schema";
import type { SearchSettingsConfig } from "../config/search-settings";
import { docFieldForSearchKey, type SearchFieldKey } from "../config/search-fields";
import type { SearchEngine } from "../search/engine";
import type { ProductDoc } from "../search/product-doc";
import type { ShopSearchContext } from "./context.server";
import { planSearch, toProductResult } from "./search.server";

// "Thử tìm" ở trang Search (task 3.2): chạy pipeline thật với cấu hình CHƯA lưu + giải thích thứ hạng
// (field nào khớp, trọng số field tốt nhất, số token khớp, điểm typo/prefix — text_match_info của Typesense).

export type PreviewHit = {
  id: string;
  title: string;
  image?: string;
  price_min: number;
  currency: string;
  available: boolean;
  rank: number;
  score: number;
  matched: { key: string; field: string; tokens: string[] }[];
  info: {
    bestFieldWeight?: number;
    fieldsMatched?: number;
    tokensMatched?: number;
    typoPrefixScore?: number;
    /** AI search: khoảng cách ngữ nghĩa (khớp theo nghĩa khi không có từ nào trùng). */
    vectorDistance?: number;
  };
};

export type PreviewResult = { total: number; tookMs: number; sort: string; hits: PreviewHit[] };

/** Field document → key cấu hình (title_vi → title, skus → sku…). */
function keyForDocField(settings: SearchSettingsConfig, field: string): string {
  const base = field.replace(/_[a-z]{2}(_[a-z0-9]+)?$/, "");
  for (const f of settings.fields) {
    const doc = docFieldForSearchKey(f.key as SearchFieldKey);
    if (doc === field || doc === base) return f.key;
  }
  return field;
}

export async function previewSearch(
  ctx: ShopSearchContext,
  settings: SearchSettingsConfig,
  q: string,
  engine: SearchEngine,
  locale = ctx.shop.primaryLocale,
): Promise<PreviewResult> {
  const preview: ShopSearchContext = { ...ctx, settings };
  const plan = planSearch(preview, { q, locale, filters: {}, perPage: 10 });
  const t0 = Date.now();
  const r = await engine.search<ProductDoc>(ctx.productIndex, {
    ...plan.main,
    facetBy: undefined,
    // Field vector không highlight được.
    highlightFields: plan.main.queryBy.filter((f) => f !== EMBEDDING_FIELD),
    perPage: 10,
  });
  return {
    total: r.found,
    tookMs: Date.now() - t0,
    sort: plan.sortKey,
    hits: r.hits.map((h, i) => {
      const p = toProductResult(h.document, ctx.shop.currency);
      const info = (h.textMatchInfo ?? {}) as Record<string, number | string>;
      return {
        id: h.document.id,
        title: h.document.title,
        image: h.document.image,
        price_min: p.price_min ?? 0,
        currency: ctx.shop.currency,
        available: h.document.available,
        rank: i + 1,
        score: h.textMatch ?? 0,
        matched: (h.highlights ?? [])
          .filter((x) => (x.matchedTokens?.length ?? 0) > 0)
          .map((x) => ({
            key: keyForDocField(settings, x.field),
            field: x.field,
            tokens: (x.matchedTokens ?? []).flat().map(String).slice(0, 5),
          })),
        info: {
          bestFieldWeight: Number(info.best_field_weight ?? NaN) || undefined,
          fieldsMatched: Number(info.fields_matched ?? NaN) || undefined,
          tokensMatched: Number(info.tokens_matched ?? NaN) || undefined,
          typoPrefixScore: Number(info.typo_prefix_score ?? NaN) || undefined,
          vectorDistance: h.vectorDistance,
        },
      };
    }),
  };
}
