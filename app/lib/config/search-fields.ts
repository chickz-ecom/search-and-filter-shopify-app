import { z } from "zod";

// Cấu hình trường tìm kiếm (docs/02-PLAN.md mục 4.3). Dùng chung admin + search-api.

export const BUILTIN_FIELD_KEYS = [
  "title",
  "description",
  "vendor",
  "product_type",
  "tags",
  "sku",
  "barcode",
  "variant_titles",
  "options",
  "collection_titles",
] as const;

export type BuiltinFieldKey = (typeof BUILTIN_FIELD_KEYS)[number];
export type MetafieldFieldKey = `mf:${string}.${string}`;
export type SearchFieldKey = BuiltinFieldKey | MetafieldFieldKey;

const METAFIELD_KEY_RE = /^mf:([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/;

export const SearchFieldKeySchema = z.union([
  z.enum(BUILTIN_FIELD_KEYS),
  z
    .string()
    .regex(
      METAFIELD_KEY_RE,
      "Metafield key must look like mf:namespace.key",
    ) as z.ZodType<MetafieldFieldKey>,
]);

export const SearchFieldSchema = z.object({
  key: SearchFieldKeySchema,
  enabled: z.boolean(),
  weight: z.number().int().min(1).max(10),
  typo: z.boolean(),
  prefix: z.boolean(),
  exactOnly: z.boolean().optional(),
});

export type SearchField = z.infer<typeof SearchFieldSchema>;

export const DEFAULT_SEARCH_FIELDS: SearchField[] = [
  { key: "title", enabled: true, weight: 10, typo: true, prefix: true },
  { key: "sku", enabled: true, weight: 9, typo: false, prefix: true },
  { key: "vendor", enabled: true, weight: 6, typo: true, prefix: true },
  { key: "product_type", enabled: true, weight: 6, typo: true, prefix: true },
  { key: "tags", enabled: true, weight: 5, typo: true, prefix: true },
  { key: "variant_titles", enabled: true, weight: 4, typo: true, prefix: true },
  { key: "options", enabled: true, weight: 4, typo: true, prefix: true },
  { key: "collection_titles", enabled: false, weight: 3, typo: true, prefix: true },
  { key: "description", enabled: true, weight: 2, typo: true, prefix: false },
  { key: "barcode", enabled: false, weight: 8, typo: false, prefix: false },
];

/** Trọng số metafield mới thêm (bảng 4.3). */
export const DEFAULT_METAFIELD_FIELD: Omit<SearchField, "key"> = {
  enabled: false,
  weight: 3,
  typo: true,
  prefix: false,
};

export function isMetafieldKey(key: string): key is MetafieldFieldKey {
  return METAFIELD_KEY_RE.test(key);
}

export function parseMetafieldKey(key: MetafieldFieldKey): { namespace: string; key: string } {
  const m = METAFIELD_KEY_RE.exec(key);
  if (!m) throw new Error(`Invalid metafield key: ${key}`);
  return { namespace: m[1], key: m[2] };
}

/** Tên field trong document cho metafield `ns.key` → `mf_ns_key` (ký tự lạ thành `_`). */
export function metafieldDocField(namespace: string, key: string): string {
  return `mf_${namespace}_${key}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Map trọng số UI 1–10 sang `query_by_weights` 0–127 của Typesense. */
export function weightToEngine(weight: number): number {
  const w = Math.min(10, Math.max(1, Math.round(weight)));
  return Math.round((w / 10) * 127);
}

/** Field document tương ứng với một SearchField (chưa tính bản dịch). */
export function docFieldForSearchKey(key: SearchFieldKey): string {
  switch (key) {
    case "title":
      return "title";
    case "description":
      return "description_text";
    case "vendor":
      return "vendor";
    case "product_type":
      return "product_type";
    case "tags":
      return "tags";
    case "sku":
      return "skus";
    case "barcode":
      return "barcodes";
    case "variant_titles":
      return "variant_titles";
    case "options":
      return "option_values";
    case "collection_titles":
      return "collection_titles";
    default: {
      const { namespace, key: k } = parseMetafieldKey(key);
      return metafieldDocField(namespace, k);
    }
  }
}

/** Field có bản dịch theo locale (title_{locale}, description_{locale}, tags_{locale}). */
export const TRANSLATABLE_KEYS: Partial<Record<SearchFieldKey, string>> = {
  title: "title",
  description: "description",
  tags: "tags",
};

/**
 * Field cần có trong document để search được. Thêm/bớt metafield làm đổi tập này → cần re-index
 * (mục 4.3). Bật/tắt và trọng số thì không.
 */
export function indexedMetafieldKeys(fields: SearchField[]): MetafieldFieldKey[] {
  return fields.map((f) => f.key).filter(isMetafieldKey);
}

/** Gộp cấu hình đã lưu với mặc định: giữ thứ tự đã lưu, bổ sung trường builtin còn thiếu. */
export function normalizeSearchFields(saved: SearchField[] | null | undefined): SearchField[] {
  const list = saved?.length ? [...saved] : [];
  const seen = new Set(list.map((f) => f.key));
  for (const def of DEFAULT_SEARCH_FIELDS) {
    if (!seen.has(def.key)) list.push({ ...def });
  }
  return list;
}
