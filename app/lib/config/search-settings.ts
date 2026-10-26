import { z } from "zod";
import { DEFAULT_SEARCH_FIELDS, SearchFieldSchema } from "./search-fields";
import { TIE_BREAKS } from "./sort-options";

const SearchTypeToggleSchema = z.object({ autocomplete: z.boolean(), results: z.boolean() });

export const SearchTypesSchema = z.object({
  products: SearchTypeToggleSchema,
  collections: SearchTypeToggleSchema,
  pages: SearchTypeToggleSchema,
  articles: SearchTypeToggleSchema,
});
export type SearchTypes = z.infer<typeof SearchTypesSchema>;

/** AI search (task 5.1): mức chặt → ngưỡng khoảng cách cosine của model embedding (đo trên all-MiniLM-L12-v2). */
export const SEMANTIC_STRICTNESS = ["strict", "balanced", "broad"] as const;
export const SEMANTIC_DISTANCE: Record<(typeof SEMANTIC_STRICTNESS)[number], number> = {
  strict: 0.5,
  balanced: 0.6,
  broad: 0.7,
};
/** Tỷ trọng vector trong rank fusion (0 = chỉ keyword, 1 = chỉ ngữ nghĩa). Keyword vẫn dẫn dắt thứ hạng. */
export const SEMANTIC_ALPHA = 0.3;

export const SearchSettingsSchema = z
  .object({
    fields: z.array(SearchFieldSchema).min(1).max(40),
    typoTolerance: z.enum(["OFF", "LOW", "NORMAL"]),
    minWordLengthFor1Typo: z.number().int().min(1).max(20),
    minWordLengthFor2Typo: z.number().int().min(1).max(30),
    prioritizeExactMatch: z.boolean(),
    matchMode: z.enum(["max_weight", "max_score", "sum_score"]),
    showOutOfStock: z.enum(["SHOW", "HIDE", "PUSH_DOWN"]),
    excludeTags: z.array(z.string().min(1).max(255)).max(100),
    variantAsProduct: z.boolean(),
    searchTypes: SearchTypesSchema,
    relevanceTieBreak: z.enum(TIE_BREAKS),
    semanticSearch: z.boolean(),
    semanticStrictness: z.enum(SEMANTIC_STRICTNESS),
    queryUnderstanding: z.boolean(),
  })
  .superRefine((s, ctx) => {
    if (s.minWordLengthFor2Typo < s.minWordLengthFor1Typo) {
      ctx.addIssue({
        code: "custom",
        path: ["minWordLengthFor2Typo"],
        message: "Must be greater than or equal to the 1-typo length",
      });
    }
    const keys = new Set<string>();
    s.fields.forEach((f, i) => {
      if (keys.has(f.key))
        ctx.addIssue({ code: "custom", path: ["fields", i, "key"], message: "Duplicate field" });
      keys.add(f.key);
    });
    if (!s.fields.some((f) => f.enabled)) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Enable at least one search field",
      });
    }
  });

export type SearchSettingsConfig = z.infer<typeof SearchSettingsSchema>;

export const DEFAULT_SEARCH_TYPES: SearchTypes = {
  products: { autocomplete: true, results: true },
  collections: { autocomplete: true, results: false },
  pages: { autocomplete: true, results: false },
  articles: { autocomplete: false, results: false },
};

export function defaultSearchSettings(): SearchSettingsConfig {
  return {
    fields: DEFAULT_SEARCH_FIELDS.map((f) => ({ ...f })),
    typoTolerance: "NORMAL",
    minWordLengthFor1Typo: 4,
    minWordLengthFor2Typo: 7,
    prioritizeExactMatch: true,
    // max_weight: trọng số quyết định thứ hạng (max_score chỉ dùng trọng số để tie-break — đã đo, Nhật ký 2026-10-26).
    matchMode: "max_weight",
    showOutOfStock: "PUSH_DOWN",
    excludeTags: [],
    variantAsProduct: false,
    searchTypes: structuredClone(DEFAULT_SEARCH_TYPES),
    relevanceTieBreak: "best_selling",
    semanticSearch: false,
    semanticStrictness: "balanced",
    queryUnderstanding: false,
  };
}
