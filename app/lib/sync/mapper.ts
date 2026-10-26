import { optionDocField } from "../config/filters";
import { metafieldDocField } from "../config/search-fields";
import { localeSuffix, type MetafieldSpec } from "../search/index-schema";
import type { ProductDoc, VariantSummary } from "../search/product-doc";
import { toMinorUnits } from "../search/query/currency";

// Mapper Product (GraphQL Admin 2026-10, shape của queries.ts) → ProductDoc (task 1.4).
// Dùng chung cho bulk (full sync) và nodes(ids:) (incremental).

type Money = { amount: string; currencyCode: string } | null;

export type ProductNode = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: string;
  description: string;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
  onlineStoreUrl: string | null;
  totalInventory: number | null;
  featuredMedia: {
    preview: { image: { url: string; altText: string | null } | null } | null;
  } | null;
  options: { name: string; values: string[] }[];
  priceRangeV2: { minVariantPrice: Money; maxVariantPrice: Money };
  compareAtPriceRange: { maxVariantCompareAtPrice: Money } | null;
  /** Metafield alias mf_0..n theo thứ tự `metafields` truyền vào query. */
  [alias: `mf_${number}`]: { value: string; type: string } | null;
};

export type VariantNode = {
  id: string;
  product: { id: string };
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  position: number;
  selectedOptions: { name: string; value: string }[];
};

export type CollectionMembership = {
  /** ID số. */
  id: string;
  handle: string;
  title: string;
  /** Vị trí 1-based theo COLLECTION_DEFAULT. */
  position?: number;
  /** Collection sắp thủ công → lưu pos_{id}. */
  manual: boolean;
};

export type ProductTranslation = { title?: string; description?: string; tags?: string[] };

export type MapOptions = {
  /** Currency gốc của shop. */
  currency: string;
  /** Cùng thứ tự với alias trong query. */
  metafields: MetafieldSpec[];
  collections?: CollectionMembership[];
  bestSellingRank?: number;
  /** locale → bản dịch. */
  translations?: Record<string, ProductTranslation>;
  /** Phương án B: country → giá min (minor units, currency của market). */
  marketPrices?: Record<string, number>;
  /** Task 1.13: khi tổng vị trí thủ công vượt ngân sách, chỉ lưu pos_ cho N vị trí đầu mỗi collection. */
  posCap?: number;
};

const DEFAULT_OPTION_NAMES = new Set(["Title"]);
const DEFAULT_VARIANT_TITLE = "Default Title";

export function gidToId(gid: string): string {
  const m = /\/(\d+)(?:\?.*)?$/.exec(gid);
  return m ? m[1] : gid;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

export function stripHtml(html: string, max = 2000): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Chuỗi sort ổn định, không dấu, lowercase. */
export function sortableTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

const toEpoch = (iso: string | null | undefined): number | undefined =>
  iso ? Math.floor(Date.parse(iso) / 1000) : undefined;

export type DocValue = string | number | boolean | string[] | number[] | undefined;

export function parseMetafieldValue(value: string, type: string): DocValue {
  const num = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) && s.trim() !== "" ? n : undefined;
  };
  try {
    switch (type) {
      case "boolean":
        return value === "true";
      case "number_integer":
      case "number_decimal":
        return num(value);
      case "date":
      case "date_time":
        return toEpoch(value);
      case "rating":
        return num(String((JSON.parse(value) as { value: string }).value));
      case "money":
        return num(String((JSON.parse(value) as { amount: string }).amount));
      default:
        if (type.startsWith("list.")) {
          let arr: unknown;
          try {
            arr = JSON.parse(value);
          } catch {
            arr = [value];
          }
          if (!Array.isArray(arr)) arr = [arr];
          const items = arr as unknown[];
          if (type === "list.number_integer" || type === "list.number_decimal") {
            return items.map((x) => Number(x)).filter(Number.isFinite);
          }
          if (type === "list.date" || type === "list.date_time") {
            return items.map((x) => toEpoch(String(x))).filter((x) => x !== undefined);
          }
          if (type === "list.rating") {
            return items.map((x) => Number((x as { value: string }).value));
          }
          return items.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
        }
        return type === "rich_text_field" || type === "multi_line_text_field"
          ? stripHtml(value, 1000)
          : value;
    }
  } catch {
    return undefined;
  }
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function mapProduct(p: ProductNode, variants: VariantNode[], opts: MapOptions): ProductDoc {
  const cur = opts.currency;
  const sorted = [...variants].sort((a, b) => a.position - b.position);
  const realOptions = p.options.filter(
    (o) =>
      !(
        DEFAULT_OPTION_NAMES.has(o.name) &&
        o.values.length === 1 &&
        o.values[0] === DEFAULT_VARIANT_TITLE
      ),
  );

  let priceMin: number;
  let priceMax: number;
  let compareMax: number | undefined;
  let discount = 0;
  let available: boolean;
  const summaries: VariantSummary[] = [];

  if (sorted.length) {
    priceMin = Infinity;
    priceMax = -Infinity;
    available = false;
    for (const v of sorted) {
      const price = toMinorUnits(v.price, cur);
      const compare = v.compareAtPrice ? toMinorUnits(v.compareAtPrice, cur) : undefined;
      priceMin = Math.min(priceMin, price);
      priceMax = Math.max(priceMax, price);
      if (compare !== undefined && compare > price) {
        compareMax = Math.max(compareMax ?? 0, compare);
        discount = Math.max(discount, Math.round(((compare - price) / compare) * 100));
      }
      available ||= v.availableForSale;
      summaries.push({
        id: gidToId(v.id),
        title: v.title,
        ...(v.sku ? { sku: v.sku } : {}),
        price,
        ...(compare !== undefined && compare > price ? { compare_at: compare } : {}),
        available: v.availableForSale,
        options: v.selectedOptions.map((o) => o.value),
      });
    }
  } else {
    // Lượt "có kết quả sớm" hoặc thiếu variant: dùng khoảng giá cấp product.
    priceMin = toMinorUnits(p.priceRangeV2.minVariantPrice?.amount ?? 0, cur);
    priceMax = toMinorUnits(p.priceRangeV2.maxVariantPrice?.amount ?? 0, cur);
    const cmp = p.compareAtPriceRange?.maxVariantCompareAtPrice;
    const compare = cmp ? toMinorUnits(cmp.amount, cur) : undefined;
    if (compare !== undefined && compare > priceMin) {
      compareMax = compare;
      discount = Math.round(((compare - priceMin) / compare) * 100);
    }
    available = (p.totalInventory ?? 0) > 0;
  }

  const image = p.featuredMedia?.preview?.image ?? null;
  const created = toEpoch(p.createdAt) ?? 0;
  const doc: ProductDoc = {
    id: gidToId(p.id),
    gid: p.id,
    handle: p.handle,
    title: p.title,
    title_sort: sortableTitle(p.title),
    vendor: p.vendor ?? "",
    product_type: p.productType ?? "",
    tags: p.tags ?? [],
    collections: [],
    collection_handles: [],
    collection_titles: [],
    description_text: stripHtml(p.description ?? ""),
    skus: uniq(sorted.map((v) => v.sku ?? "").filter(Boolean)),
    barcodes: uniq(sorted.map((v) => v.barcode ?? "").filter(Boolean)),
    variant_titles: uniq(
      sorted.map((v) => v.title).filter((t) => t && t !== DEFAULT_VARIANT_TITLE),
    ),
    option_values: uniq(realOptions.flatMap((o) => o.values)),
    price_min: Number.isFinite(priceMin) ? priceMin : 0,
    price_max: Number.isFinite(priceMax) ? priceMax : 0,
    discount_pct: discount,
    on_sale: discount > 0,
    available,
    inventory_total: Math.max(0, Math.min(2_147_483_647, p.totalInventory ?? 0)),
    created_at: created,
    published_at: toEpoch(p.publishedAt) ?? created,
    updated_at: toEpoch(p.updatedAt) ?? created,
    variants_json: JSON.stringify(summaries),
  };
  if (compareMax !== undefined) doc.compare_at_max = compareMax;
  if (image?.url) doc.image = image.url;
  if (image?.altText) doc.image_alt = image.altText;
  if (opts.bestSellingRank !== undefined) doc.best_selling_rank = opts.bestSellingRank;

  for (const o of realOptions) {
    const field = optionDocField(o.name) as `opt_${string}`;
    doc[field] = uniq([...((doc[field] as string[] | undefined) ?? []), ...o.values]);
  }

  for (const c of opts.collections ?? []) {
    doc.collections.push(c.id);
    doc.collection_handles.push(c.handle);
    doc.collection_titles.push(c.title);
    if (c.manual && c.position !== undefined && (!opts.posCap || c.position <= opts.posCap)) {
      doc[`pos_${c.id}`] = c.position;
    }
  }

  opts.metafields.forEach((m, i) => {
    const raw = p[`mf_${i}`];
    if (!raw?.value) return;
    const v = parseMetafieldValue(raw.value, raw.type || m.type);
    if (v !== undefined)
      doc[metafieldDocField(m.namespace, m.key) as `mf_${string}`] =
        v as ProductDoc[`mf_${string}`];
  });

  for (const [locale, t] of Object.entries(opts.translations ?? {})) {
    const s = localeSuffix(locale);
    if (t.title) doc[`title_${s}`] = t.title;
    if (t.description) doc[`description_${s}`] = stripHtml(t.description);
    if (t.tags?.length) doc[`tags_${s}`] = t.tags;
  }

  for (const [country, price] of Object.entries(opts.marketPrices ?? {})) {
    doc[`price_min_${country.toLowerCase()}`] = price;
  }
  return doc;
}

/** Product có nên nằm trong index không (incremental: nodes() trả cả product draft/không publish). */
export function isIndexable(
  p: Pick<ProductNode, "status" | "onlineStoreUrl"> | null | undefined,
): boolean {
  return Boolean(p && p.status === "ACTIVE" && p.onlineStoreUrl);
}
