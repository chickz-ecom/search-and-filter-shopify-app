import type { Redis } from "ioredis";
import type { SearchEngine, SearchParams } from "../search/engine";
import type { ContentDoc, ProductDoc } from "../search/product-doc";
import { buildTextQuery, normalizeQuery } from "../search/query/text-query";
import { popularQueries } from "./analytics.server";
import { fixedPriceMarket, stopwordsFor, type ShopSearchContext } from "./context.server";
import { toProductResult, type ProductResult } from "./search.server";

// Autocomplete (mục 6.1 /suggest, p95 < 80 ms ở server): một multi-search gồm sản phẩm + collection/page/article,
// cộng từ khoá phổ biến từ Redis. Giá trả về là giá gốc; SDK lấy giá theo market (≤ 6 ID).

export type SuggestBody = {
  query: string;
  products: Partial<ProductResult>[];
  collections: { title: string; url: string; handle: string }[];
  pages: { title: string; url: string }[];
  articles: { title: string; url: string }[];
  suggestions: string[];
  total_products: number;
  currency: string;
};

export async function executeSuggest(
  ctx: ShopSearchContext,
  req: { q?: string | null; locale: string; limit?: number; country?: string | null },
  deps: { engine: SearchEngine; redis?: Redis },
): Promise<SuggestBody> {
  const q = normalizeQuery(req.q);
  const limit = Math.max(1, Math.min(10, req.limit ?? 6));
  const types = ctx.settings.searchTypes;
  const empty: SuggestBody = {
    query: q,
    products: [],
    collections: [],
    pages: [],
    articles: [],
    suggestions: [],
    total_products: 0,
    currency: ctx.shop.currency,
  };
  if (!q) return empty;
  const indexed = ctx.indexedFields.length ? new Set(ctx.indexedFields) : undefined;
  const text = buildTextQuery(ctx.settings, {
    locale: req.locale,
    primaryLocale: ctx.shop.primaryLocale,
    indexedLocales: ctx.shop.locales.filter((l) => l !== ctx.shop.primaryLocale),
    indexedFields: indexed,
    mode: "suggest",
  });
  const searches: { collection: string; params: SearchParams }[] = [];
  if (types.products.autocomplete) {
    const filters = [...(ctx.settings.showOutOfStock === "HIDE" ? ["available:=true"] : [])];
    if (ctx.settings.excludeTags.length)
      filters.push(
        `tags:!=[${ctx.settings.excludeTags.map((t) => "`" + t.replace(/`/g, "") + "`").join(",")}]`,
      );
    searches.push({
      collection: ctx.productIndex,
      params: {
        q,
        ...text,
        // Autocomplete: luôn cho phép tiền tố ở các trường đang bật prefix; thêm typo cho từ đang gõ.
        filterBy: filters.join(" && ") || undefined,
        sortBy:
          ctx.settings.showOutOfStock === "PUSH_DOWN"
            ? "_eval(available:true):desc,_text_match:desc"
            : "_text_match:desc",
        perPage: limit,
        stopwords: stopwordsFor(ctx, req.locale),
        includeFields: [
          "id",
          "gid",
          "handle",
          "title",
          "vendor",
          "product_type",
          "image",
          "image_alt",
          "available",
          "price_min",
          "price_max",
          "compare_at_max",
          "discount_pct",
          "on_sale",
          "tags",
          "variants_json",
        ],
        searchCutoffMs: 150,
        useCache: true,
        cacheTtl: 30,
      },
    });
  }
  const contentTypes = (["collections", "pages", "articles"] as const).filter(
    (t) => types[t].autocomplete,
  );
  if (contentTypes.length) {
    const typeValue = contentTypes.map((t) => t.slice(0, -1));
    searches.push({
      collection: ctx.contentIndex,
      params: {
        q,
        queryBy: ["title", "body_text"],
        queryByWeights: [127, 20],
        prefix: [true, false],
        filterBy: `type:=[${typeValue.join(",")}]`,
        perPage: 8,
        searchCutoffMs: 100,
        useCache: true,
        cacheTtl: 60,
      },
    });
  }
  const [results, suggestions] = await Promise.all([
    searches.length
      ? deps.engine.multiSearch<ProductDoc | ContentDoc>(searches)
      : Promise.resolve([]),
    deps.redis
      ? popularQueries(deps.redis, ctx.shop.id, q, 5).catch(() => [])
      : Promise.resolve([]),
  ]);
  const market = fixedPriceMarket(ctx, req.country);
  const priceField =
    market && indexed?.has(`price_min_${req.country!.toLowerCase()}`)
      ? `price_min_${req.country!.toLowerCase()}`
      : undefined;
  const out: SuggestBody = {
    ...empty,
    suggestions,
    currency: priceField ? market!.currency : ctx.shop.currency,
  };
  let i = 0;
  if (types.products.autocomplete) {
    const r = results[i++];
    out.products = (r?.hits ?? []).map((h) =>
      toProductResult(h.document as ProductDoc, out.currency, priceField),
    );
    out.total_products = r?.found ?? 0;
  }
  if (contentTypes.length) {
    for (const h of results[i]?.hits ?? []) {
      const d = h.document as ContentDoc;
      if (d.type === "collection")
        out.collections.push({ title: d.title, url: d.url, handle: d.handle });
      else if (d.type === "page") out.pages.push({ title: d.title, url: d.url });
      else out.articles.push({ title: d.title, url: d.url });
    }
  }
  return out;
}
