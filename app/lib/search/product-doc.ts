// Document trong Typesense (docs/02-PLAN.md mục 4.2). Giá: currency gốc của shop, minor units;
// CHỈ dùng cho filter/sort — giá hiển thị lấy từ Storefront API (D15).

export type ProductDoc = {
  id: string;
  gid: string;
  handle: string;
  title: string;
  title_sort: string;
  vendor: string;
  product_type: string;
  tags: string[];
  /** ID số của collection (không phải gid). */
  collections: string[];
  collection_handles: string[];
  collection_titles: string[];
  description_text: string;
  skus: string[];
  barcodes: string[];
  variant_titles: string[];
  /** Mọi giá trị option, để search. Facet theo từng option nằm ở `opt_*`. */
  option_values: string[];
  price_min: number;
  price_max: number;
  compare_at_max?: number;
  discount_pct: number;
  on_sale: boolean;
  available: boolean;
  inventory_total: number;
  image?: string;
  image_alt?: string;
  image_2?: string;
  created_at: number;
  published_at: number;
  updated_at: number;
  best_selling_rank?: number;
  variants_json: string;
  /** opt_{slug}: string[]; pos_{collectionId}: number; mf_*: ...; price_min_{CC}: number;
   *  title_{locale}/description_{locale}: string; tags_{locale}: string[] */
  [
    dynamic:
      | `opt_${string}`
      | `pos_${string}`
      | `mf_${string}`
      | `price_min_${string}`
      | `title_${string}`
      | `description_${string}`
      | `tags_${string}`
  ]: string | number | boolean | string[] | number[] | undefined;
};

export type VariantSummary = {
  id: string;
  title: string;
  sku?: string;
  price: number;
  compare_at?: number;
  available: boolean;
  options: string[];
};

/** Document trong `c_{shopId}`: collection, page, article (autocomplete + tab kết quả). */
export type ContentDoc = {
  id: string;
  type: "collection" | "page" | "article";
  title: string;
  handle: string;
  url: string;
  body_text: string;
  image?: string;
  products_count?: number;
  updated_at: number;
};
