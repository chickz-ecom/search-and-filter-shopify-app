// GraphQL Admin 2026-10 cho sync. Dựa trên các operation đã validate trong docs/shopify-api/admin/*.graphql
// (MCP validate, schema 2026-10). Query sinh động (metafield alias) được kiểm bằng test + validate.sh.

export type MetafieldRef = { namespace: string; key: string };

/** Alias `mf_0..n` cho metafield đã cấu hình — không dùng connection `metafields` (ít dòng JSONL hơn). */
export function metafieldAliases(metafields: MetafieldRef[]): string {
  return metafields
    .map(
      (m, i) =>
        `mf_${i}: metafield(namespace: ${JSON.stringify(m.namespace)}, key: ${JSON.stringify(m.key)}) { value type }`,
    )
    .join("\n        ");
}

/** Chỉ product Active + published lên Online Store (status:active đã loại UNLISTED). */
export const PRODUCT_FILTER = "status:active AND published_status:published";

const PRODUCT_CORE_FIELDS = `id
        handle
        title
        vendor
        productType
        tags
        status
        description
        createdAt
        publishedAt
        updatedAt
        onlineStoreUrl
        totalInventory
        featuredMedia { preview { image { url altText } } }
        options { name values optionValues { name swatch { color } } }
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
        compareAtPriceRange { maxVariantCompareAtPrice { amount currencyCode } }`;

/** (a) Bulk phẳng: chỉ field cấp product + metafield alias. `extraFilter` để shard theo created_at. */
export function bulkProductsQuery(metafields: MetafieldRef[], extraFilter?: string): string {
  const q = extraFilter ? `${PRODUCT_FILTER} AND ${extraFilter}` : PRODUCT_FILTER;
  return `{
  products(query: ${JSON.stringify(q)}) {
    edges {
      node {
        ${PRODUCT_CORE_FIELDS}
        ${metafieldAliases(metafields)}
      }
    }
  }
}`;
}

// VERIFY: ProductVariant.barcode deprecated (→ barcodes(first:)); connection đó không dùng được trong bulk.
const VARIANT_FIELDS = `id
        product { id }
        title
        sku
        barcode
        price
        compareAtPrice
        availableForSale
        inventoryQuantity
        position
        selectedOptions { name value }`;

/**
 * Phương án B (task 2.8, sau flag fixedMarketPrices): giá cuối của variant cho country có price list cố định.
 * VERIFY: contextualPricing dùng được bên trong bulk (schema hợp lệ; docs không nói rõ) — HUMAN_TODO F4.
 */
export function contextualPricingAliases(countries: string[]): string {
  return countries
    .filter((c) => /^[A-Z]{2}$/.test(c))
    .map(
      (c) =>
        `cp_${c}: contextualPricing(context: { country: ${c} }) { price { amount currencyCode } compareAtPrice { amount currencyCode } }`,
    )
    .join("\n        ");
}

/** (b) Bulk phẳng: productVariants ở top-level, có product { id } để join theo ID. */
export function bulkVariantsQuery(extraFilter?: string, priceCountries: string[] = []): string {
  const base = "product_status:active AND published_status:published";
  const q = extraFilter ? `${base} AND ${extraFilter}` : base;
  return `{
  productVariants(query: ${JSON.stringify(q)}) {
    edges {
      node {
        ${VARIANT_FIELDS}
        ${contextualPricingAliases(priceCountries)}
      }
    }
  }
}`;
}

/**
 * (c) Bulk collection + thành viên. Chạy với groupObjects: true: Shopify chỉ đảm bảo giữ thứ tự connection
 * con ở dạng grouped (docs/shopify-api/admin-graphql.md mục 2c) — cần cho pos_{collectionId}.
 */
export function bulkCollectionsQuery(): string {
  return `{
  collections(query: "published_status:published") {
    edges {
      node {
        id
        handle
        title
        updatedAt
        sortOrder
        products(sortKey: COLLECTION_DEFAULT) {
          edges { node { id } }
        }
      }
    }
  }
}`;
}

/** Cấu hình so sánh benchmark 1.3: một query lồng (product → variants, collections). Không dùng trong production. */
export function bulkNestedQuery(metafields: MetafieldRef[], priceCountries: string[] = []): string {
  return `{
  products(query: ${JSON.stringify(PRODUCT_FILTER)}) {
    edges {
      node {
        ${PRODUCT_CORE_FIELDS}
        ${metafieldAliases(metafields)}
        variants { edges { node { ${VARIANT_FIELDS.replace("product { id }", "")} ${contextualPricingAliases(priceCountries)} } } }
        collections { edges { node { id handle title sortOrder } } }
      }
    }
  }
}`;
}

/** (d) Checksum đêm: siêu nhẹ. */
export function bulkChecksumQuery(): string {
  return `{
  products(query: ${JSON.stringify(PRODUCT_FILTER)}) {
    edges { node { id updatedAt } }
  }
}`;
}

export const BULK_RUN_MUTATION = `mutation BulkRunQuery($query: String!, $groupObjects: Boolean!) {
  bulkOperationRunQuery(query: $query, groupObjects: $groupObjects) {
    bulkOperation { id status createdAt }
    userErrors { field message code }
  }
}`;

export const BULK_STATUS_QUERY = `query BulkOperationStatus($id: ID!) {
  bulkOperation(id: $id) {
    id status type errorCode createdAt completedAt objectCount rootObjectCount fileSize url partialDataUrl
  }
}`;

export const BULK_CANCEL_MUTATION = `mutation BulkOperationCancel($id: ID!) {
  bulkOperationCancel(id: $id) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;

/** Incremental (mục 3 của ghi chú): core ≤ 50 ID ≈ 750 điểm. Variants và collections lấy riêng. */
export function productsCoreByIdsQuery(metafields: MetafieldRef[]): string {
  return `query ProductsCoreByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    id
    ... on Product {
        ${PRODUCT_CORE_FIELDS.replace(/^id\n\s*/, "")}
        ${metafieldAliases(metafields)}
    }
  }
}`;
}

/** Lượt "có kết quả sớm" (mục 5.1 bước 5): vài trang product mới cập nhật, chưa có variant (dùng priceRangeV2). */
export function earlyProductsQuery(metafields: MetafieldRef[]): string {
  return `query EarlyProducts($first: Int!, $cursor: String, $query: String!) {
  products(first: $first, after: $cursor, query: $query, sortKey: UPDATED_AT, reverse: true) {
    nodes {
        ${PRODUCT_CORE_FIELDS}
        ${metafieldAliases(metafields)}
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
}

export function variantsByProductIdsQuery(priceCountries: string[] = []): string {
  return `query VariantsByProductIds($query: String!, $cursor: String) {
  productVariants(first: ${priceCountries.length ? 100 : 250}, after: $cursor, query: $query) {
    nodes {
        ${VARIANT_FIELDS}
        ${contextualPricingAliases(priceCountries)}
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
}

export const VARIANTS_BY_PRODUCT_IDS_QUERY = variantsByProductIdsQuery();

/** ≈ 53 điểm/sản phẩm → tối đa 18 ID mỗi request. */
export const PRODUCT_COLLECTIONS_BY_IDS_QUERY = `query ProductCollectionsByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    id
    ... on Product {
      collections(first: 50) {
        nodes { id handle title }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export const COLLECTION_PRODUCTS_ORDERED_QUERY = `query CollectionProductsOrdered($id: ID!, $cursor: String) {
  collection(id: $id) {
    id
    handle
    title
    updatedAt
    sortOrder
    products(first: 250, after: $cursor, sortKey: COLLECTION_DEFAULT) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export const DELTA_PRODUCTS_QUERY = `query DeltaProductsUpdatedSince($cursor: String, $query: String!) {
  products(first: 250, after: $cursor, query: $query, sortKey: UPDATED_AT) {
    nodes { id updatedAt status onlineStoreUrl }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const SHOP_INFO_QUERY = `query ShopInfo {
  shop {
    id
    name
    currencyCode
    myshopifyDomain
    primaryDomain { host url }
    enabledPresentmentCurrencies
    ianaTimezone
  }
  shopLocales { locale primary published }
}`;

export const METAFIELD_DEFINITIONS_QUERY = `query ProductMetafieldDefinitions($cursor: String) {
  metafieldDefinitions(ownerType: PRODUCT, first: 250, after: $cursor) {
    nodes { namespace key name type { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Ước lượng cost để executor chờ đúng lượng (docs mục 3). */
export const COST = {
  coreBase: 2,
  corePerProduct: 15,
  variantsPage: 502,
  collectionsPerProduct: 53,
  delta: 252,
} as const;

export const CORE_BATCH = 50;
export const COLLECTIONS_BATCH = 18;
