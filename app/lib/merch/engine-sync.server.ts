import { z } from "zod";
import type { CurationItem, SearchEngine, SynonymItem } from "../search/engine";
import { curationSetName, stopwordsId, synonymSetName } from "../search/names";
import { quote } from "../search/query/filters";
import type { Db } from "../shop/shop.server";

// Merchandising → engine (task 2.5): synonym set, curation set (pin/hide/boost/bury), stopwords.
// Redirect không vào engine: search-api tra trước khi search (pipeline bước 2).

export const MerchConditionSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    match: z.enum(["exact", "contains"]).default("exact"),
    /** ID số collection: rule áp dụng trên trang collection đó (qua override tag). */
    collectionId: z.string().regex(/^\d+$/).optional(),
  })
  .refine((c) => c.query || c.collectionId, { message: "A rule needs a query or a collection" });

export const MerchActionsSchema = z.object({
  pin: z
    .array(
      z.object({
        productId: z.string().regex(/^\d+$/),
        position: z.number().int().min(1).max(250),
      }),
    )
    .max(50)
    .default([]),
  hide: z.array(z.string().regex(/^\d+$/)).max(250).default([]),
  /** weight > 0: boost, < 0: bury. filter theo field document (vendor, tags, product_type, collections). */
  boost: z
    .array(
      z.object({
        field: z.enum(["vendor", "product_type", "tags", "collections"]),
        value: z.string().min(1).max(255),
        weight: z.number().int().min(-10).max(10),
      }),
    )
    .max(20)
    .default([]),
});

export type MerchCondition = z.infer<typeof MerchConditionSchema>;
export type MerchActions = z.infer<typeof MerchActionsSchema>;

/** Tag override cho trang collection: search-api gửi `override_tags=col_{id}`. */
export const collectionOverrideTag = (collectionId: string) => `col_${collectionId}`;

type RuleRow = {
  id: string;
  enabled: boolean;
  condition: unknown;
  actions: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
};

export function buildBoostSort(
  boost: MerchActions["boost"],
  base = "_text_match:desc",
): string | undefined {
  if (!boost.length) return undefined;
  const parts = boost.map((b) => `(${b.field}:=${quote(b.value)}):${b.weight}`);
  return `_eval([${parts.join(", ")}]):desc,${base}`;
}

export function buildCurationItems(rules: RuleRow[]): CurationItem[] {
  const out: CurationItem[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const cond = MerchConditionSchema.safeParse(r.condition);
    const act = MerchActionsSchema.safeParse(r.actions);
    if (!cond.success || !act.success) continue;
    const c = cond.data;
    const a = act.data;
    const item: CurationItem = {
      id: `rule_${r.id}`,
      rule: c.query
        ? {
            query: c.query.toLowerCase(),
            match: c.match,
            ...(c.collectionId ? { tags: [collectionOverrideTag(c.collectionId)] } : {}),
          }
        : { tags: [collectionOverrideTag(c.collectionId!)] },
      includes: a.pin.map((p) => ({ id: p.productId, position: p.position })),
      excludes: a.hide.map((id) => ({ id })),
      sortBy: buildBoostSort(
        a.boost,
        c.query ? "_text_match:desc" : "best_selling_rank(missing_values: last):asc",
      ),
      // Rule trang collection không có query: không xoá token nào.
      removeMatchedTokens: false,
      stopProcessing: false,
    };
    if (r.startsAt) item.effectiveFromTs = Math.floor(r.startsAt.getTime() / 1000);
    if (r.endsAt) item.effectiveToTs = Math.floor(r.endsAt.getTime() / 1000);
    out.push(item);
  }
  return out;
}

type SynonymRow = {
  id: string;
  type: string;
  root: string | null;
  terms: string[];
  locale: string | null;
};

export function buildSynonymItems(rows: SynonymRow[]): SynonymItem[] {
  return rows
    .map((s) => {
      const terms = [...new Set(s.terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
      if (s.type === "one_way" && s.root?.trim()) {
        return terms.length
          ? {
              id: `syn_${s.id}`,
              root: s.root.trim().toLowerCase(),
              synonyms: terms,
              ...(s.locale ? { locale: s.locale } : {}),
            }
          : null;
      }
      return terms.length >= 2
        ? { id: `syn_${s.id}`, synonyms: terms, ...(s.locale ? { locale: s.locale } : {}) }
        : null;
    })
    .filter((x): x is SynonymItem => x !== null);
}

/** Đẩy toàn bộ merch của shop sang engine (idempotent). Gọi khi lưu ở admin và trước full sync. */
export async function pushMerchToEngine(db: Db, engine: SearchEngine, shopId: string) {
  const [synonyms, rules, stopwords] = await Promise.all([
    db.synonym.findMany({ where: { shopId } }),
    db.merchRule.findMany({ where: { shopId } }),
    db.stopWord.findMany({ where: { shopId } }),
  ]);
  await engine.upsertSynonymSet(synonymSetName(shopId), buildSynonymItems(synonyms));
  await engine.upsertCurationSet(curationSetName(shopId), buildCurationItems(rules));
  const byLocale = new Map<string, string[]>();
  for (const w of stopwords)
    byLocale.set(w.locale, [...(byLocale.get(w.locale) ?? []), w.word.toLowerCase()]);
  for (const [locale, words] of byLocale)
    await engine.upsertStopwords(stopwordsId(shopId, locale), words, locale);
  return { synonyms: synonyms.length, rules: rules.length, stopwordLocales: [...byLocale.keys()] };
}
