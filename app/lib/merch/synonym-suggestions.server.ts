import type { Redis } from "ioredis";
import type { SearchEngine } from "../search/engine";
import { EMBEDDING_FIELD } from "../search/index-schema";
import type { ProductDoc } from "../search/product-doc";
import { queryKey } from "../search/query/text-query";
import { rkey } from "../redis.server";
import type { ShopSearchContext } from "../search-service/context.server";
import type { Db } from "../shop/shop.server";
import { synonymCandidates, type CandidateReason } from "./synonym-candidates";

// Gợi ý synonym từ truy vấn 0 kết quả (task 5.3). Merchant duyệt từng gợi ý (Analytics) → tạo synonym một chiều
// "truy vấn → từ trong catalog". Không tự áp dụng. Bỏ qua → nhớ 90 ngày.

export type SynonymSuggestion = {
  query: string;
  searches: number;
  term: string;
  reason: CandidateReason;
  /** Số sản phẩm mà từ gợi ý tìm ra (đã kiểm chứng). */
  products: number;
};

export const dismissedKey = (shopId: string) => rkey("syn-dismissed", shopId);
const DISMISS_TTL_S = 90 * 24 * 3600;
const lower = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

export async function dismissSuggestion(redis: Redis, shopId: string, query: string) {
  await redis.sadd(dismissedKey(shopId), queryKey(query));
  await redis.expire(dismissedKey(shopId), DISMISS_TTL_S);
}

export async function suggestSynonyms(
  db: Db,
  ctx: ShopSearchContext,
  engine: SearchEngine,
  deps: { redis?: Redis; now?: Date; days?: number; limit?: number } = {},
): Promise<SynonymSuggestion[]> {
  const shopId = ctx.shop.id;
  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - (deps.days ?? 30) * 24 * 3600_000);
  const [rows, synonyms, redirects, dismissed] = await Promise.all([
    db.analyticsDaily.groupBy({
      by: ["query"],
      where: { shopId, date: { gte: since }, zeroResults: { gt: 0 }, query: { not: "" } },
      _sum: { zeroResults: true },
      orderBy: { _sum: { zeroResults: "desc" } },
      take: 50,
    }),
    db.synonym.findMany({ where: { shopId }, select: { root: true, terms: true } }),
    db.redirect.findMany({ where: { shopId }, select: { query: true } }),
    deps.redis?.smembers(dismissedKey(shopId)).catch(() => []) ?? Promise.resolve([] as string[]),
  ]);
  const covered = new Set([
    ...synonyms
      .flatMap((s) => [s.root ?? "", ...s.terms])
      .filter(Boolean)
      .map(lower),
    ...redirects.map((r) => r.query),
    ...dismissed,
  ]);
  const pending = rows.filter(
    (r) => !covered.has(lower(r.query)) && !covered.has(queryKey(r.query)),
  );
  if (!pending.length) return [];

  // Từ vựng catalog: loại sản phẩm, tag, thương hiệu, giá trị option.
  const indexed = new Set(ctx.indexedFields);
  const fields = [
    "product_type",
    "tags",
    "vendor",
    ...ctx.indexedFields.filter((f) => f.startsWith("opt_") && !f.includes("*")),
  ].filter((f) => indexed.has(f));
  const facets = await engine.search<ProductDoc>(ctx.productIndex, {
    q: "*",
    queryBy: ["title"],
    facetBy: fields,
    maxFacetValues: 250,
    perPage: 0,
  });
  const vocab = [...new Set(facets.facets.flatMap((f) => f.values.map((v) => v.value)))];
  const semantic = indexed.has(EMBEDDING_FIELD);

  const out: SynonymSuggestion[] = [];
  for (const row of pending) {
    if (out.length >= (deps.limit ?? 10)) break;
    let candidates: { term: string; reason: CandidateReason }[] = synonymCandidates(
      row.query,
      vocab,
    );
    if (!candidates.length && semantic) {
      // Không giống chữ nào → thử theo nghĩa: loại sản phẩm phổ biến nhất trong các sản phẩm gần nghĩa.
      const near = await engine.search<ProductDoc>(ctx.productIndex, {
        q: row.query,
        queryBy: [EMBEDDING_FIELD],
        vectorQuery: `${EMBEDDING_FIELD}:([], distance_threshold: 0.55)`,
        perPage: 5,
        includeFields: ["product_type"],
      });
      const counts = new Map<string, number>();
      for (const h of near.hits) {
        const t = h.document.product_type?.trim();
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (best && lower(best) !== lower(row.query))
        candidates = [{ term: best, reason: "meaning" }];
    }
    for (const c of candidates) {
      const check = await engine.search<ProductDoc>(ctx.productIndex, {
        q: c.term,
        queryBy: ["title", "product_type", "tags", "vendor"],
        perPage: 0,
      });
      if (check.found > 0) {
        out.push({
          query: row.query,
          searches: row._sum.zeroResults ?? 0,
          term: c.term,
          reason: c.reason,
          products: check.found,
        });
        break;
      }
    }
  }
  return out;
}
