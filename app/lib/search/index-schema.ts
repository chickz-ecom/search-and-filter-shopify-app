import { metafieldDocField } from "../config/search-fields";
import type { CollectionSchema, FieldDef, FieldType } from "./engine";

// Dựng schema collection Typesense từ cấu hình shop (mục 5.1 bước 1). Field nào có trong schema
// quyết định cái gì search/filter/sort được; trọng số và bật/tắt áp dụng lúc query (mục 4.3).

export type MetafieldSpec = {
  namespace: string;
  key: string;
  /** Tên type metafield của Shopify, vd. `number_integer`, `list.single_line_text_field`. */
  type: string;
};

export type ProductSchemaInput = {
  name: string;
  /** Metafield dùng cho search, filter hoặc sort. */
  metafields: MetafieldSpec[];
  /** Locale phụ (khác primary) có bản dịch → title_{l}, description_{l}, tags_{l}. */
  locales: string[];
  synonymSets?: string[];
  curationSets?: string[];
};

export function metafieldEngineType(shopifyType: string): FieldType {
  switch (shopifyType) {
    case "number_integer":
    case "date":
    case "date_time":
      return "int64";
    case "number_decimal":
    case "rating":
    case "money":
      return "float";
    case "boolean":
      return "bool";
    case "list.number_integer":
    case "list.date":
    case "list.date_time":
      return "int64[]";
    case "list.number_decimal":
    case "list.rating":
      return "float[]";
    default:
      return shopifyType.startsWith("list.") ? "string[]" : "string";
  }
}

/** Locale an toàn cho tên field (`pt-BR` → `pt_br`). */
export function localeSuffix(locale: string): string {
  return locale.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

const stored = (name: string, type: FieldType = "string"): FieldDef => ({
  name,
  type,
  index: false,
  optional: true,
});

export const PRODUCT_BASE_FIELDS: FieldDef[] = [
  stored("gid"),
  stored("handle"),
  { name: "title", type: "string" },
  { name: "title_sort", type: "string", sort: true },
  { name: "vendor", type: "string", facet: true },
  { name: "product_type", type: "string", facet: true },
  { name: "tags", type: "string[]", facet: true },
  { name: "collections", type: "string[]", facet: true },
  { name: "collection_handles", type: "string[]", facet: true },
  { name: "collection_titles", type: "string[]" },
  { name: "description_text", type: "string" },
  { name: "skus", type: "string[]" },
  { name: "barcodes", type: "string[]" },
  { name: "variant_titles", type: "string[]" },
  { name: "option_values", type: "string[]" },
  { name: "price_min", type: "int64", facet: true, sort: true },
  { name: "price_max", type: "int64", sort: true },
  { name: "compare_at_max", type: "int64", optional: true },
  { name: "discount_pct", type: "int32", sort: true },
  { name: "on_sale", type: "bool", facet: true },
  { name: "available", type: "bool", facet: true },
  { name: "inventory_total", type: "int32" },
  stored("image"),
  stored("image_alt"),
  stored("image_2"),
  { name: "created_at", type: "int64", sort: true },
  { name: "published_at", type: "int64", sort: true },
  { name: "updated_at", type: "int64", sort: true },
  { name: "best_selling_rank", type: "int32", optional: true, sort: true },
  stored("variants_json"),
  // Field động (regex): option theo tên, thứ tự thủ công theo collection, giá theo market (phương án B).
  { name: "opt_.*", type: "string[]", facet: true, optional: true },
  { name: "pos_.*", type: "int32", optional: true, sort: true },
  { name: "price_min_.*", type: "int64", optional: true, facet: true, sort: true },
];

export function buildProductSchema(input: ProductSchemaInput): CollectionSchema {
  const fields: FieldDef[] = [...PRODUCT_BASE_FIELDS];
  for (const locale of input.locales) {
    const s = localeSuffix(locale);
    fields.push(
      { name: `title_${s}`, type: "string", optional: true },
      { name: `description_${s}`, type: "string", optional: true },
      { name: `tags_${s}`, type: "string[]", optional: true },
    );
  }
  const seen = new Set<string>();
  for (const mf of input.metafields) {
    const name = metafieldDocField(mf.namespace, mf.key);
    if (seen.has(name)) continue;
    seen.add(name);
    const type = metafieldEngineType(mf.type);
    const numeric = type.startsWith("int") || type.startsWith("float");
    fields.push({ name, type, optional: true, facet: true, sort: numeric && !type.endsWith("[]") });
  }
  return {
    name: input.name,
    fields,
    tokenSeparators: ["-", "/", "."],
    synonymSets: input.synonymSets,
    curationSets: input.curationSets,
  };
}

export function buildContentSchema(name: string): CollectionSchema {
  return {
    name,
    fields: [
      { name: "type", type: "string", facet: true },
      { name: "title", type: "string" },
      // handle lọc được: search-api tra collection theo handle (SDK collection('summer')).
      { name: "handle", type: "string", facet: true },
      stored("url"),
      // CollectionSortOrder của Shopify → sort mặc định trang collection (mục 4.4).
      stored("sort_order"),
      { name: "body_text", type: "string" },
      stored("image"),
      { name: "products_count", type: "int32", optional: true },
      { name: "updated_at", type: "int64", sort: true },
    ],
  };
}

/** Field metafield có trong schema hiện tại nhưng thiếu ở input mới (hoặc ngược lại) → cần re-index. */
export function schemaNeedsReindex(currentFields: FieldDef[], next: CollectionSchema): boolean {
  const cur = new Map(currentFields.map((f) => [f.name, f.type]));
  return next.fields.some((f) => !f.name.includes("*") && cur.get(f.name) !== f.type);
}
