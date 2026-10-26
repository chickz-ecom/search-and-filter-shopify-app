import { z } from "zod";

// Sort options (docs/02-PLAN.md mục 4.4).

export const BUILTIN_SORT_KEYS = [
  "relevance",
  "manual",
  "best_selling",
  "price_asc",
  "price_desc",
  "created_desc",
  "created_asc",
  "title_asc",
  "title_desc",
  "discount_desc",
] as const;

export type BuiltinSortKey = (typeof BUILTIN_SORT_KEYS)[number];
export type MetafieldSortKey = `mf:${string}.${string}:${"asc" | "desc"}`;
export type SortKey = BuiltinSortKey | MetafieldSortKey;

const MF_SORT_RE = /^mf:([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+):(asc|desc)$/;

export const SortKeySchema = z.union([
  z.enum(BUILTIN_SORT_KEYS),
  z
    .string()
    .regex(
      MF_SORT_RE,
      "Metafield sort must look like mf:namespace.key:asc",
    ) as z.ZodType<MetafieldSortKey>,
]);

export const LocalizedLabelSchema = z.record(z.string(), z.string());
export type LocalizedLabel = z.infer<typeof LocalizedLabelSchema>;

export const SortOptionSchema = z.object({
  key: SortKeySchema,
  label: LocalizedLabelSchema,
  enabled: z.boolean(),
  position: z.number().int().min(0),
});
export type SortOptionConfig = z.infer<typeof SortOptionSchema>;

export function isMetafieldSortKey(key: string): key is MetafieldSortKey {
  return MF_SORT_RE.test(key);
}

export function parseMetafieldSortKey(key: MetafieldSortKey) {
  const m = MF_SORT_RE.exec(key);
  if (!m) throw new Error(`Invalid metafield sort key: ${key}`);
  return { namespace: m[1], key: m[2], direction: m[3] as "asc" | "desc" };
}

export const DEFAULT_SORT_OPTIONS: SortOptionConfig[] = [
  { key: "relevance", label: { en: "Relevance", vi: "Liên quan" }, enabled: true, position: 0 },
  { key: "manual", label: { en: "Featured", vi: "Nổi bật" }, enabled: true, position: 1 },
  {
    key: "best_selling",
    label: { en: "Best selling", vi: "Bán chạy" },
    enabled: true,
    position: 2,
  },
  {
    key: "price_asc",
    label: { en: "Price, low to high", vi: "Giá tăng dần" },
    enabled: true,
    position: 3,
  },
  {
    key: "price_desc",
    label: { en: "Price, high to low", vi: "Giá giảm dần" },
    enabled: true,
    position: 4,
  },
  { key: "created_desc", label: { en: "Newest", vi: "Mới nhất" }, enabled: true, position: 5 },
  { key: "created_asc", label: { en: "Oldest", vi: "Cũ nhất" }, enabled: false, position: 6 },
  {
    key: "title_asc",
    label: { en: "Alphabetically, A-Z", vi: "Tên A-Z" },
    enabled: true,
    position: 7,
  },
  {
    key: "title_desc",
    label: { en: "Alphabetically, Z-A", vi: "Tên Z-A" },
    enabled: false,
    position: 8,
  },
  {
    key: "discount_desc",
    label: { en: "Biggest discount", vi: "Giảm giá nhiều nhất" },
    enabled: false,
    position: 9,
  },
];

/** Sort chỉ có nghĩa trên trang collection. */
export const COLLECTION_ONLY_SORTS: ReadonlySet<SortKey> = new Set<SortKey>(["manual"]);
/** Sort chỉ có nghĩa khi có `q`. */
export const QUERY_ONLY_SORTS: ReadonlySet<SortKey> = new Set<SortKey>(["relevance"]);

export const TIE_BREAKS = ["best_selling", "created_desc"] as const;
export type TieBreak = (typeof TIE_BREAKS)[number];

/** Nhãn theo locale: locale chính xác → ngôn ngữ gốc (vi-VN → vi) → en → key. */
export function labelFor(label: LocalizedLabel, locale: string, fallback: string): string {
  const base = locale.split("-")[0];
  return label[locale] ?? label[base] ?? label.en ?? Object.values(label)[0] ?? fallback;
}

// VERIFY: giá trị enum CollectionSortOrder (Admin API 2026-10) — docs/shopify-api/admin-graphql.md
/** Map `CollectionSortOrder` của Shopify sang sort key của app (mặc định cho trang collection). */
export function sortKeyFromCollectionSortOrder(order: string | null | undefined): SortKey {
  switch (order) {
    case "BEST_SELLING":
      return "best_selling";
    case "ALPHA_ASC":
      return "title_asc";
    case "ALPHA_DESC":
      return "title_desc";
    case "PRICE_ASC":
      return "price_asc";
    case "PRICE_DESC":
      return "price_desc";
    case "CREATED":
      return "created_asc";
    case "CREATED_DESC":
      return "created_desc";
    case "MANUAL":
    default:
      return "manual";
  }
}

/** Danh sách đã bật, đúng thứ tự, lọc theo ngữ cảnh trang. */
export function visibleSortOptions(
  options: SortOptionConfig[],
  ctx: { hasQuery: boolean; isCollection: boolean },
): SortOptionConfig[] {
  return options
    .filter((o) => o.enabled)
    .filter((o) => ctx.isCollection || !COLLECTION_ONLY_SORTS.has(o.key))
    .filter((o) => ctx.hasQuery || !QUERY_ONLY_SORTS.has(o.key))
    .sort((a, b) => a.position - b.position);
}
