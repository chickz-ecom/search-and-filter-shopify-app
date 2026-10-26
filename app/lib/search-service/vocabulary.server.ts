import { facetFieldFor, type FilterItem } from "../config/filters";
import type { SearchEngine } from "../search/engine";
import type { Vocabulary } from "../search/query/understand";
import type { ShopSearchContext } from "./context.server";

// Từ vựng cho hiểu truy vấn (task 5.2): giá trị facet CÓ THẬT trong index của shop (thương hiệu, option như màu/size).
// Không dùng product_type/tag: từ đó vẫn nằm trong truy vấn để keyword khớp (và tránh tự lọc lặp lại).
const SOURCES = new Set<FilterItem["source"]>(["vendor", "option"]);
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; vocab: Vocabulary }>();

export async function facetVocabulary(
  ctx: ShopSearchContext,
  items: FilterItem[],
  engine: SearchEngine,
  now = Date.now(),
): Promise<Vocabulary> {
  const indexed = new Set(ctx.indexedFields);
  const usable = items.filter((i) => SOURCES.has(i.source) && indexed.has(facetFieldFor(i)));
  if (!usable.length) return [];
  const key = `${ctx.productIndex}|${usable.map((i) => i.id).join(",")}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.vocab;
  const fields = [...new Set(usable.map(facetFieldFor))];
  const r = await engine.search(ctx.productIndex, {
    q: "*",
    queryBy: ["title"],
    facetBy: fields,
    maxFacetValues: 250,
    perPage: 0,
  });
  const byField = new Map(r.facets.map((f) => [f.field, f.values.map((v) => v.value)]));
  const vocab = usable.map((i) => ({
    filterId: i.id,
    values: byField.get(facetFieldFor(i)) ?? [],
  }));
  cache.set(key, { at: now, vocab });
  if (cache.size > 5_000) cache.delete(cache.keys().next().value!);
  return vocab;
}
