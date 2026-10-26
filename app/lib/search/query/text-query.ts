import {
  TRANSLATABLE_KEYS,
  docFieldForSearchKey,
  weightToEngine,
  type SearchField,
} from "../../config/search-fields";
import type { SearchSettingsConfig } from "../../config/search-settings";
import { EMBEDDING_FIELD, localeSuffix } from "../index-schema";
import type { SearchParams } from "../engine";

// Query builder từ SearchSettings.fields (task 2.2). Trọng số/bật-tắt áp dụng lúc query → không re-index.

export type TextQueryContext = {
  /** Locale của khách (request.locale). */
  locale: string;
  primaryLocale: string;
  /** Locale phụ có trong index (title_{l}...). */
  indexedLocales: string[];
  /** Field có thật trong schema hiện tại; field chưa index (metafield mới thêm) bị bỏ qua. */
  indexedFields?: ReadonlySet<string>;
  mode: "search" | "suggest";
  /** AI search (task 5.1): chỉ truyền khi có từ khoá, gói cho phép và index có field vector. */
  semantic?: { distance: number; alpha: number };
};

export type TextQueryPart = Pick<
  SearchParams,
  | "queryBy"
  | "queryByWeights"
  | "numTypos"
  | "prefix"
  | "prioritizeExactMatch"
  | "textMatchType"
  | "minLen1Typo"
  | "minLen2Typo"
  | "vectorQuery"
>;

function maxTypos(settings: SearchSettingsConfig): number {
  switch (settings.typoTolerance) {
    case "OFF":
      return 0;
    case "LOW":
      return 1;
    default:
      return 2;
  }
}

function localeMatch(ctx: TextQueryContext): string | null {
  if (ctx.locale === ctx.primaryLocale) return null;
  const candidates = [ctx.locale, ctx.locale.split("-")[0]];
  const hit = candidates.find((l) => ctx.indexedLocales.includes(l));
  return hit ? localeSuffix(hit) : null;
}

export function buildTextQuery(
  settings: SearchSettingsConfig,
  ctx: TextQueryContext,
): TextQueryPart {
  const typos = maxTypos(settings);
  const loc = localeMatch(ctx);
  const queryBy: string[] = [];
  const weights: number[] = [];
  const numTypos: number[] = [];
  const prefix: boolean[] = [];

  const push = (field: string, f: SearchField) => {
    if (queryBy.includes(field)) return;
    if (ctx.indexedFields && !ctx.indexedFields.has(field)) return;
    queryBy.push(field);
    weights.push(weightToEngine(f.weight));
    numTypos.push(f.typo && !f.exactOnly ? typos : 0);
    // Autocomplete luôn cần prefix cho trường có prefix; exactOnly tắt prefix.
    prefix.push(f.exactOnly ? false : f.prefix);
  };

  const enabled = settings.fields.filter((f) => f.enabled);
  for (const f of enabled) {
    const base = TRANSLATABLE_KEYS[f.key];
    // Bản dịch đứng trước để khớp ngôn ngữ của khách được ưu tiên khi trọng số bằng nhau.
    if (loc && base) push(`${base}_${loc}`, f);
    push(docFieldForSearchKey(f.key), f);
  }

  if (!queryBy.length) {
    // Không bao giờ để query_by rỗng (Typesense báo lỗi) — fallback title.
    queryBy.push("title");
    weights.push(127);
    numTypos.push(typos);
    prefix.push(true);
  }

  // Hybrid: thêm field vector vào cuối query_by (trọng số thấp nhất, không typo/prefix — các mảng per-field phải
  // cùng độ dài, đã đo trên Typesense 30.1). Autocomplete giữ keyword thuần cho nhanh.
  let vectorQuery: string | undefined;
  if (
    ctx.semantic &&
    ctx.mode === "search" &&
    (!ctx.indexedFields || ctx.indexedFields.has(EMBEDDING_FIELD))
  ) {
    queryBy.push(EMBEDDING_FIELD);
    weights.push(1);
    numTypos.push(0);
    prefix.push(false);
    vectorQuery = `${EMBEDDING_FIELD}:([], alpha: ${ctx.semantic.alpha}, distance_threshold: ${ctx.semantic.distance})`;
  }

  return {
    queryBy,
    queryByWeights: weights,
    numTypos,
    prefix,
    prioritizeExactMatch: settings.prioritizeExactMatch,
    textMatchType: settings.matchMode,
    minLen1Typo: settings.minWordLengthFor1Typo,
    minLen2Typo: settings.minWordLengthFor2Typo,
    ...(vectorQuery ? { vectorQuery } : {}),
  };
}

/** Chuẩn hoá query của khách: trim, gộp khoảng trắng, giới hạn độ dài. */
export function normalizeQuery(q: string | null | undefined): string {
  return (q ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Dạng so khớp redirect/rule: lowercase + bỏ dấu câu ở hai đầu. */
export function queryKey(q: string): string {
  return normalizeQuery(q)
    .toLowerCase()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}
