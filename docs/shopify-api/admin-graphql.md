# Shopify Admin GraphQL API (2026-10) — catalog-sync operations

Verified on 2026-10-26 against the **Admin GraphQL schema `2026-10`**, using the Shopify Dev MCP (`@shopify/dev-mcp` v1.17.0). Every operation below **passed the MCP `validate` tool** (`api: admin`, `version: 2026-10`). One exception: `partner-active-subscription.graphql` was validated against `api: partner`, `version: 2026-10`.

Each operation is also saved as its own file in [`./admin/`](./admin/). Field signatures, defaults, enum values and deprecations were also read straight from the introspection JSON that the validator uses (`dist/data/admin_2026-10.json.gz` inside `@shopify/dev-mcp`). Facts about behaviour (limits, ordering, webhooks) come from shopify.dev doc search, with the URL given each time.

**Validation status legend**
- ✅ **validated**: passed `validate` with no notes.
- ⚠️ **validated + deprecation note**: valid, but uses a field that is deprecated in 2026-10. The reason is explained in that section.
- **UNVERIFIED**: the schema and docs could not confirm this. It needs a live-store check.

Required scopes reported by the validator, across all operations: `read_products`, `read_inventory`, `read_locations`, `read_publications` (or `read_product_listings`), `read_markets`, `read_locales`, `read_translations`, `read_pixels`/`write_pixels`, plus `unauthenticated_read_product_listings` (the storefront token inherits the app's unauthenticated scopes). For media fields the validator lists `read_products, read_files, read_themes, …`. This is the union of scopes that can grant access to `Media`, and `read_products` alone is expected to be enough. **UNVERIFIED.**

---

## 0. Contradictions with our planning assumptions (read first)

| Assumption | Verdict for 2026-10 |
|---|---|
| `published_status:published` filter works | ✅ **Confirmed.** It is still a documented filter on `products`, `productVariants` and `collections`. `published`/`visible` means "published to the online store". The `publishable_status` filter is the deprecated one (since 2025-12). |
| `groupObjects` exists and defaults to `false` | ✅ **Confirmed.** The signature is `bulkOperationRunQuery(groupObjects: Boolean! = false, query: String!)`. The default changed to `false` in 2026-01. |
| 5 concurrent bulk ops | ✅ **Confirmed**: up to **5 bulk query operations at the same time per app per shop** (2026-01+). Bulk mutations have a separate limit of 5. When the limit is hit, the user error code is `LIMIT_REACHED`. |
| `Collection.sortOrder` | ✅ **Confirmed.** `sortOrder: CollectionSortOrder!` exists and is not deprecated. |
| `contextualPricing` exists on ProductVariant | ✅ **Confirmed.** The signature is `contextualPricing(context: ContextualPricingContext!): ProductVariantContextualPricing!`. Using it **inside bulk** is **UNVERIFIED**. |

Other things the plan probably assumed that are **wrong or changed** in 2026-10:
1. **`currentBulkOperation` is deprecated.** Use `bulkOperation(id:)` or `bulkOperations(query:)` instead.
2. **`Product.publishedOnCurrentPublication` and `resourcePublicationOnCurrentPublication` are both deprecated.** For Online Store visibility, use `onlineStoreUrl` (it is `null` when the product is not published to the Online Store) or `publishedOnPublication(publicationId: <Online Store publication>)`.
3. **`ProductVariant.barcode` is deprecated** in favour of `barcodes(first:)`, a connection of `ProductVariantBarcode`. A variant can have up to 20 barcodes. `ProductVariantBarcode` does **not** implement `Node`, so it can't be used as a connection inside bulk. Bulk queries keep using `barcode`.
4. **`Collection.ruleSet` is deprecated in favour of `Collection.sources`** (since 2026-07). The `collection_type` search filter was **removed** in 2026-07, according to the migration guide, even though the 2026-10 schema description still lists it. Don't use it.
5. **`InventoryItem.variant` is deprecated.** Use `InventoryItem.variants(first:)` instead.
6. **`Product.featuredImage` and `Product.images` are deprecated.** Use `featuredMedia { preview { image { url altText } } }` instead.
7. **`Market.priceList`, `Market.regions` and `Market.webPresence` are deprecated.** Use `catalogs { priceList }`, `conditions.regionsCondition.regions` and `webPresences` instead.
8. **Managed pricing is now called "Shopify App Pricing"**, and Shopify tells apps on it to check subscriptions through the **Partner API `activeSubscription(appId:, shopId:)`**, not `currentAppInstallation`. Shopify App Pricing **does not send Billing API webhooks** (for example `app_subscriptions/update`).
9. **There are no webhooks for catalog or price-list changes**, so market price data needs periodic re-sync.
10. A product can have **`status: UNLISTED`** (2025-10+). `status:active` already excludes it.

---

## 1. Bulk operations

### Start a bulk query ✅
`admin/bulk-run-query.graphql`
```graphql
mutation BulkRunQuery($query: String!) {
  bulkOperationRunQuery(query: $query, groupObjects: false) {
    bulkOperation {
      id
      status
      createdAt
    }
    userErrors {
      field
      message
      code
    }
  }
}
```
- `groupObjects: Boolean! = false` (default `false` since 2026-01). Leave it `false`: grouping "slows down bulk operations and increases the likelihood of timeouts". Source: https://shopify.dev/changelog/posts/bulk-operations-group-objects-default-changed-to-false
- Payload `userErrors` has type `BulkOperationUserError { code field message }`. Possible codes: `INVALID`, `LIMIT_REACHED`, `OPERATION_IN_PROGRESS`.
- **Concurrency:** "In API versions 2026-01 and higher, each app can run up to five bulk query operations concurrently per shop." Bulk queries and bulk mutations can run at the same time. Source: https://shopify.dev/docs/apps/build/apis/graphql-admin/bulk-operations/queries
- **Query restrictions** (same source; the schema description repeats them):
  - at least 1 connection
  - **at most 5 connections in total**
  - **at most 2 levels of nested connections**
  - connections must implement `Node`
  - the top-level `node`/`nodes` fields can't be used
  - the operation must finish within **10 days**
  - results stay available for **7 days**
- Bulk queries take **no GraphQL variables**. Inline every literal, including the search string, metafield keys and country codes.
- Rate limits: only the mutation itself and the polling requests cost points. The bulk query's execution does not.

### Poll one bulk operation ✅
`admin/bulk-operation-status.graphql`
```graphql
query BulkOperationStatus($id: ID!) {
  bulkOperation(id: $id) {
    id
    status
    type
    errorCode
    createdAt
    completedAt
    objectCount
    rootObjectCount
    fileSize
    url
    partialDataUrl
  }
}
```
- All the requested fields exist on `BulkOperation`: `status`, `errorCode`, `objectCount`, `url`, `partialDataUrl`, `completedAt`, `fileSize`. `rootObjectCount`, `type` and `query` are also available.
- `BulkOperationStatus` values: `CANCELED CANCELING COMPLETED CREATED EXPIRED FAILED RUNNING`.
- `BulkOperationErrorCode` values: `ACCESS_DENIED INTERNAL_SERVER_ERROR TIMEOUT`. When a bulk operation fails, partial data may still be available at `partialDataUrl`.
- `currentBulkOperation(type:)` is **DEPRECATED**: "Use `bulkOperations` with status filter instead."

### List running bulk queries (replaces `currentBulkOperation`) ✅
`admin/bulk-operations-running.graphql`
```graphql
query RunningBulkQueries {
  bulkOperations(first: 10, query: "status:running operation_type:query", sortKey: CREATED_AT, reverse: true) {
    nodes {
      id
      status
      createdAt
      objectCount
    }
  }
}
```
- `bulkOperations(query:)` accepts these filters: `created_at`, `id`, `operation_type` (`query`|`mutation`), `status` (`canceled|canceling|completed|created|failed|running`).

### Cancel ✅
`admin/bulk-operation-cancel.graphql`
```graphql
mutation BulkOperationCancel($id: ID!) {
  bulkOperationCancel(id: $id) {
    bulkOperation {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}
```

### JSONL format
- Each line is one node. Nested-connection children get an automatic `__parentId` field holding the parent's GID. You can't query this field explicitly. Source: https://shopify.dev/docs/apps/build/apis/graphql-admin/bulk-operations/queries
- With the old grouped format, a child line always came directly after its parent. With `groupObjects: false` (the default) the guide does not promise that, so the parser must **join on `__parentId` rather than on line position**. **UNVERIFIED** whether ungrouped output keeps any ordering.

### `bulk_operations/finish` webhook
Webhook topic enum: `BULK_OPERATIONS_FINISH`. Sample payload from https://shopify.dev/docs/api/webhooks/2026-01:
```json
{ "admin_graphql_api_id": "gid://shopify/BulkOperation/147595010",
  "completed_at": "2024-01-01T07:34:56-05:00", "created_at": "2026-10-01T10:20:57-04:00",
  "error_code": null, "status": "completed", "type": "query" }
```
- All the expected fields are confirmed: `admin_graphql_api_id`, `status`, `error_code` and `type`, plus `completed_at` and `created_at`.
- **The payload has no `url`.** Fetch it with `bulkOperation(id:)` (above).
- The webhook fires for queries **and** mutations. Delivery isn't guaranteed, so keep a polling fallback.

---

## 2. Bulk inner queries
Validate each one as an ordinary query. Then send the selection set, without the `query BulkInner… {}` wrapper name if you prefer, as the `query` string of `bulkOperationRunQuery`.

### (a) Flat products ✅
`admin/bulk-inner-products.graphql`
```graphql
query BulkInnerProducts {
  products(query: "status:active AND published_status:published") {
    edges {
      node {
        id
        handle
        title
        vendor
        productType
        tags
        status
        description
        descriptionHtml
        createdAt
        publishedAt
        updatedAt
        onlineStoreUrl
        totalInventory
        tracksInventory
        hasOnlyDefaultVariant
        hasOutOfStockVariants
        isGiftCard
        templateSuffix
        variantsCount {
          count
        }
        category {
          id
          fullName
        }
        seo {
          title
          description
        }
        featuredMedia {
          id
          mediaContentType
          alt
          preview {
            image {
              url
              altText
              width
              height
            }
          }
        }
        options {
          id
          name
          position
          values
          optionValues {
            id
            name
            swatch {
              color
            }
          }
        }
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
          maxVariantPrice {
            amount
            currencyCode
          }
        }
        compareAtPriceRange {
          minVariantCompareAtPrice {
            amount
            currencyCode
          }
          maxVariantCompareAtPrice {
            amount
            currencyCode
          }
        }
        mf_0: metafield(namespace: "custom", key: "material") {
          value
          type
        }
        mf_1: metafield(namespace: "custom", key: "color") {
          value
          type
        }
      }
    }
  }
}
```
- **Search syntax** (from the 2026-10 `products(query:)` filter table):
  - `status`: `active|archived|draft|unlisted`. The table lists `active` as the default value, but we still pass it explicitly. `status:active` excludes `UNLISTED`. "Unlisted" products are hidden from search and collections, and they are a separate enum value only in 2025-10+.
  - `published_status`: `published`/`visible` = "published to the online store". `unpublished`, `online_store_channel` and `unavailable` are also valid, as is `{channel_id_or_app_handle}-published|-intended|-hidden`. **`published_status:published` is still valid in 2026-10.**
  - `publishable_status` is **deprecated** (2025-12).
- **Image:** `featuredImage` is deprecated, so use `featuredMedia { preview { image { url altText } } }`. `Media` is an interface (`MediaImage | Video | ExternalVideo | Model3d`). `preview.image` works for all of them. `media(first: n)` is a connection. It would count toward the 5-connection limit and add a nesting level, so it is left out of the flat query.
- **Options:** `options(first: Int): [ProductOption!]!` is a **list, not a connection**, so it costs no bulk-connection slot. It has `name`, `position`, `values: [String!]!` and `optionValues { id name hasVariants swatch { color image } linkedMetafieldValue }`.
- **Prices:** `priceRange` is deprecated, so use `priceRangeV2 { min/maxVariantPrice { amount currencyCode } }`. The compare-at range is `compareAtPriceRange { min/maxVariantCompareAtPrice }`.
- **Metafield aliases** work (`metafield(namespace:, key:) { value type }`). `jsonValue` is also available.
- `description` is plain text. `descriptionHtml` is the HTML version. `bodyHtml` is deprecated.
- `onlineStoreUrl` is `null` when the product isn't published to the Online Store (schema description). Index it as a second safety check.
- An extra field worth having is `category { id fullName }` (Standard Product Taxonomy).

### (b) Top-level variants ⚠️ (`barcode` deprecated)
`admin/bulk-inner-variants.graphql`
```graphql
query BulkInnerVariants {
  productVariants(query: "product_status:active AND published_status:published") {
    edges {
      node {
        id
        product {
          id
        }
        title
        sku
        barcode
        price
        compareAtPrice
        availableForSale
        inventoryQuantity
        inventoryPolicy
        sellableOnlineQuantity
        position
        updatedAt
        selectedOptions {
          name
          value
        }
      }
    }
  }
}
```
- `productVariants(query:)` supports `product_status`, `published_status`, `product_ids`, `updated_at` and others.
- `price` and `compareAtPrice` are `Money` **scalars** (decimal strings), not `MoneyV2` objects.
- `barcode` is deprecated in favour of `barcodes(first:)`. `ProductVariantBarcode` doesn't implement `Node`, which breaks the bulk rule, so bulk keeps `barcode`, which returns the first barcode. Outside bulk, use `barcodes` (see `variant-barcodes.graphql`).
- An extra field worth having is `sellableOnlineQuantity: Int!`.

### (c) Collections ✅
`admin/bulk-inner-collections.graphql`
```graphql
query BulkInnerCollections {
  collections(query: "published_status:published") {
    edges {
      node {
        id
        handle
        title
        updatedAt
        sortOrder
        templateSuffix
        productsCount {
          count
        }
        sources {
          __typename
          id
          title
          ... on CollectionConditionsSource {
            targetType
          }
        }
        products(sortKey: COLLECTION_DEFAULT) {
          edges {
            node {
              id
            }
          }
        }
      }
    }
  }
}
```
- **`ruleSet` is DEPRECATED** ("Use `sources` instead"). It is still queryable in 2026-10, but collections that use multi-source features can't be represented in it.
- `sources: [CollectionSource!]!` is an interface with two types:
  - `CollectionConditionsSource`: `targetType: PRODUCTS|VARIANTS`, `inclusion`/`exclusion` with typed conditions and selections, and a `products` connection.
  - `CollectionSubCollectionsSource`: `collections`.
- Always select `__typename`. Unknown future condition types arrive as `CollectionSourceInclusionConditionUnknown`. Sources: https://shopify.dev/docs/apps/build/product-merchandising/products-and-collections/migrate-to-flexible-collections and https://shopify.dev/changelog/posts/new-collection-model-and-apis-now-available
- **Variant-level collections** exist (`targetType: VARIANTS`): only some variants of a product belong. For those, `Product.variantsInCollection(collectionId:)` gives the member variants.
- **`CollectionSortOrder`**: `ALPHA_ASC ALPHA_DESC BEST_SELLING CREATED CREATED_DESC MANUAL MOST_RELEVANT PRICE_ASC PRICE_DESC`.
- **`ProductCollectionSortKeys`**: `BEST_SELLING COLLECTION_DEFAULT CREATED ID MANUAL PRICE RELEVANCE TITLE`. The default for `Collection.products(sortKey:)` is `COLLECTION_DEFAULT`. `Collection.products` has no `query` argument.
- **Does bulk keep the collection's product order? UNVERIFIED.** The guide says "the order of each connection type is preserved", but only in its grouped-output example, and `groupObjects` now defaults to `false`.
  - **Recommendation:** use bulk only for *membership*.
  - For collections whose `sortOrder` is `MANUAL` (or where the position matters), get the order from query 6 (paginated `collection.products(sortKey: COLLECTION_DEFAULT)`).
  - Alternatively, run this one bulk query with `groupObjects: true` and test the order on a dev store.
- `Collection.products` returns *all* member products, including drafts and unpublished ones. Intersect with the indexed product set.
- The webhook payload still has legacy `rules` only when the collection fits the legacy shape (see the new-model guide).

### (d) Checksum ✅
`admin/bulk-inner-checksum.graphql`
```graphql
query BulkInnerChecksum {
  products(query: "status:active AND published_status:published") {
    edges {
      node {
        id
        updatedAt
      }
    }
  }
}
```

---

## 3. Incremental sync by IDs

### Full document per product ✅ (⚠️ `barcode`)
`admin/incremental-products-by-ids.graphql`
```graphql
query IncrementalProductsByIds($ids: [ID!]!, $onlineStorePublicationId: ID!) {
  nodes(ids: $ids) {
    __typename
    id
    ... on Product {
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
      publishedOnOnlineStore: publishedOnPublication(publicationId: $onlineStorePublicationId)
      totalInventory
      variantsCount {
        count
      }
      featuredMedia {
        preview {
          image {
            url
            altText
          }
        }
      }
      options {
        name
        values
      }
      priceRangeV2 {
        minVariantPrice {
          amount
          currencyCode
        }
        maxVariantPrice {
          amount
          currencyCode
        }
      }
      compareAtPriceRange {
        minVariantCompareAtPrice {
          amount
          currencyCode
        }
        maxVariantCompareAtPrice {
          amount
          currencyCode
        }
      }
      mf_0: metafield(namespace: "custom", key: "material") {
        value
        type
      }
      variants(first: 100) {
        nodes {
          id
          title
          sku
          barcode
          price
          compareAtPrice
          availableForSale
          inventoryQuantity
          position
          selectedOptions {
            name
            value
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      collections(first: 50) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
```

### Recommended split: product core (≤50 IDs) + variants by product IDs + collections ✅
`admin/incremental-products-core-by-ids.graphql`
```graphql
query IncrementalProductsCoreByIds($ids: [ID!]!, $onlineStorePublicationId: ID!) {
  nodes(ids: $ids) {
    __typename
    id
    ... on Product {
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
      publishedOnOnlineStore: publishedOnPublication(publicationId: $onlineStorePublicationId)
      totalInventory
      variantsCount {
        count
      }
      featuredMedia {
        preview {
          image {
            url
            altText
          }
        }
      }
      options {
        name
        values
      }
      priceRangeV2 {
        minVariantPrice {
          amount
          currencyCode
        }
        maxVariantPrice {
          amount
          currencyCode
        }
      }
      compareAtPriceRange {
        minVariantCompareAtPrice {
          amount
          currencyCode
        }
        maxVariantCompareAtPrice {
          amount
          currencyCode
        }
      }
      mf_0: metafield(namespace: "custom", key: "material") {
        value
        type
      }
    }
  }
}
```
`admin/incremental-variants-by-product-ids.graphql`
```graphql
query IncrementalVariantsByProductIds($query: String!, $cursor: String) {
  productVariants(first: 250, after: $cursor, query: $query) {
    nodes {
      id
      product {
        id
      }
      title
      sku
      barcode
      price
      compareAtPrice
      availableForSale
      inventoryQuantity
      position
      selectedOptions {
        name
        value
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```
Use `$query` like `"product_ids:8474977763649,8474977796417"` (a numeric-ID list. The `product_ids` filter is documented on `productVariants`).
`admin/incremental-product-collections-by-ids.graphql`
```graphql
query IncrementalProductCollectionsByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    id
    ... on Product {
      collections(first: 50) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
```
`admin/variant-barcodes.graphql`
```graphql
query VariantBarcodes($id: ID!) {
  productVariant(id: $id) {
    id
    barcodes(first: 20) {
      nodes {
        value
        type
      }
    }
  }
}
```

**Online Store visibility from the app's side:**
- `publishedOnCurrentPublication` is **DEPRECATED**. It also means "the *app's* publication", which is not the Online Store unless the app is a sales channel.
- Use `onlineStoreUrl`. It is documented as "If `null`, then the product isn't published to the online store sales channel."
- Or use `publishedOnPublication(publicationId: $onlineStorePublicationId)`, with the Online Store publication ID looked up once per shop:
`admin/online-store-publication.graphql`
```graphql
query FindOnlineStorePublication {
  publications(first: 50, catalogType: APP) {
    nodes {
      id
      autoPublish
      catalog {
        id
        title
        ... on AppCatalog {
          apps(first: 1) {
            nodes {
              id
              handle
              title
            }
          }
        }
      }
    }
  }
}
```
- **UNVERIFIED:** which value identifies the Online Store publication. It is probably `catalog.title == "Online Store"` or the app handle `online_store`. Confirm on a dev store. Until then, prefer `onlineStoreUrl` and the `published_status:published` search filter, which needs no ID.
- Per-market visibility: market catalogs can carry their own `publication`. `Product.publishedInContext(context: { country })` answers "is it visible to buyers in country X?":
`admin/product-market-context.graphql`
```graphql
query ProductMarketContext($id: ID!, $country: CountryCode!) {
  product(id: $id) {
    id
    publishedInContext(context: { country: $country })
    contextualPricing(context: { country: $country }) {
      priceRange {
        minVariantPrice {
          amount
          currencyCode
        }
        maxVariantPrice {
          amount
          currencyCode
        }
      }
    }
  }
}
```

**Cost estimate** (rules from https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits):
- Rules: scalar/enum = 0, object = 1, connection = "sized by `first`/`last`", mutation = 10. The single-query maximum is **1,000** points. Input arrays (for example `ids`) are limited to **250** items.
- The exact connection formula used below (2 + `first` × cost per node) and the multiplication of `nodes(ids:)` by the number of IDs are **not stated in the 2026-10 docs**, so these figures are **UNVERIFIED estimates**. Send the `Shopify-GraphQL-Cost-Debug=1` header to get a per-field breakdown.

| Operation | Estimated cost |
|---|---|
| Full document (`incremental-products-by-ids`) | ≈ 14 (product core) + ~202 (`variants(first:100)` with `selectedOptions`) + ~52 (`collections(first:50)`) ≈ **270 per product**. **50 IDs ≈ 13,500, more than 10× over the 1,000 cap (MAX_COST_EXCEEDED).** The largest safe batch is **3 IDs**. With the originally planned `collections(first:250)` and `barcodes`, even a single product is about 770. |
| Recommended split: core (`incremental-products-core-by-ids`) | ≈ 14–15 per product (+1 per extra metafield alias) → **50 IDs ≈ 700–750**. Fits under the cap. |
| Recommended split: `productVariants(first:250)` | ≈ 502 per page, for many products at once |
| Recommended split: `nodes{collections(first:50)}` | ≈ 53 per product → **≤ 18 IDs** per request |
| Throughput at the restore rate | Standard plan (100 pts/s): a 750-point request every ~7.5 s. Plus (1000 pts/s): ~1 per second. |
| Alternative | If many products change at once (for example a merchant CSV import), start a bulk query instead. It costs no points, at most 5 can run at a time, and it adds some latency. |

---

## 4. Delta by `updated_at` ✅
`admin/delta-products-updated-since.graphql`
```graphql
query DeltaProductsUpdatedSince($cursor: String, $query: String!) {
  products(first: 250, after: $cursor, query: $query, sortKey: UPDATED_AT) {
    nodes {
      id
      updatedAt
      status
      onlineStoreUrl
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```
- Pass `$query = "updated_at:>'2026-10-01T00:00:00Z'"` (the documented syntax `updated_at:>'…'`).
- `sortKey: UPDATED_AT` matches the filter. The docs advise using the same sort key as a range filter, otherwise large shops time out.
- `ProductSortKeys`: `CREATED_AT ID INVENTORY_TOTAL PRODUCT_TYPE PUBLISHED_AT RELEVANCE TITLE UPDATED_AT VENDOR`.
- Estimated cost: 2 + 250 = ~252 (UNVERIFIED).

---

## 5. Inventory webhook → product ✅
`inventory_levels/update` sample payload (https://shopify.dev/docs/api/webhooks):
```json
{ "inventory_item_id": 271878346596884015, "location_id": 24826418, "available": 10,
  "updated_at": "2021-12-31T19:00:00-05:00",
  "admin_graphql_api_id": "gid://shopify/InventoryLevel/24826418?inventory_item_id=271878346596884015" }
```
`admin/inventory-item-to-product.graphql`
```graphql
query InventoryItemToProduct($inventoryItemId: ID!) {
  inventoryItem(id: $inventoryItemId) {
    id
    tracked
    variants(first: 10) {
      nodes {
        id
        inventoryQuantity
        availableForSale
        product {
          id
          totalInventory
        }
      }
    }
  }
}
```
- Use `$inventoryItemId = "gid://shopify/InventoryItem/<inventory_item_id>"`.
- **`InventoryItem.variant` is DEPRECATED** (changelog 2025-12-02, https://shopify.dev/changelog/posts/inventory-item-variant-field-deprecation). Use the `variants(first:)` connection. It returns 1 node for now, but Shopify is preparing for several variants to share one item.

Alternatively, use the webhook's `admin_graphql_api_id` directly:
`admin/inventory-level-by-id.graphql`
```graphql
query InventoryLevelById($id: ID!) {
  inventoryLevel(id: $id) {
    id
    updatedAt
    location {
      id
    }
    quantities(names: ["available", "on_hand"]) {
      name
      quantity
    }
    item {
      id
      variants(first: 10) {
        nodes {
          id
          product {
            id
          }
        }
      }
    }
  }
}
```
- `InventoryLevel.available` no longer exists. Use `quantities(names: ["available", …])`.
- Batch many `inventory_item_id`s with `nodes(ids:)` (InventoryItem implements Node), or with `productVariants(query: "…")`.

---

## 6. Collection membership with order ✅
`admin/collection-products-ordered.graphql`
```graphql
query CollectionProductsOrdered($id: ID!, $cursor: String) {
  collection(id: $id) {
    id
    handle
    updatedAt
    sortOrder
    productsCount {
      count
    }
    products(first: 250, after: $cursor, sortKey: COLLECTION_DEFAULT) {
      nodes {
        id
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```
- `products(sortKey: COLLECTION_DEFAULT)` returns the collection's own sort order (`sortOrder`). Store the page position to get a "featured/manual" rank.
- Estimated cost: ~254 per page (UNVERIFIED).

---

## 7. Shop info ✅
`admin/shop-info.graphql`
```graphql
query ShopInfo {
  shop {
    id
    name
    currencyCode
    enabledPresentmentCurrencies
    ianaTimezone
    myshopifyDomain
    primaryDomain {
      host
      url
    }
    plan {
      publicDisplayName
      partnerDevelopment
      shopifyPlus
    }
  }
  shopLocales {
    locale
    name
    primary
    published
  }
}
```
- `ShopPlan.displayName` is **deprecated**. Use `publicDisplayName`. Its values include Basic, Grow, Advanced, Plus, Plus Trial, Development, Trial, Starter, Retail, Lite, Paused, Inactive, Agentic, and others. There are also `partnerDevelopment` and `shopifyPlus` booleans.
- `shopLocales(published: Boolean = false)` returns `ShopLocale { locale name primary published marketWebPresences }`.

---

## 8. Markets ✅
`admin/markets.graphql`
```graphql
query Markets($cursor: String) {
  markets(first: 50, after: $cursor) {
    nodes {
      id
      handle
      name
      type
      status
      currencySettings {
        baseCurrency {
          currencyCode
          currencyName
          enabled
        }
        localCurrencies
        roundingEnabled
      }
      conditions {
        conditionTypes
        regionsCondition {
          regions(first: 250) {
            nodes {
              __typename
              id
              name
              ... on MarketRegionCountry {
                code
                currency {
                  currencyCode
                }
              }
            }
          }
        }
      }
      webPresences(first: 5) {
        nodes {
          id
          subfolderSuffix
          domain {
            host
          }
          defaultLocale {
            locale
          }
          alternateLocales {
            locale
          }
          rootUrls {
            locale
            url
          }
        }
      }
      catalogs(first: 5) {
        nodes {
          id
          title
          status
          publication {
            id
          }
          priceList {
            id
            currency
            fixedPricesCount
            parent {
              adjustment {
                type
                value
              }
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```
- `Market`:
  - `type: MarketType` (`CHANNEL COMPANY_LOCATION LOCATION NONE REGION`) and `status: MarketStatus` (`ACTIVE DRAFT`). `enabled` is deprecated, so use `status`.
  - `markets(type:)` and the `status:`/`market_type:` query filters exist.
  - `currencySettings { baseCurrency { currencyCode } localCurrencies roundingEnabled }`.
  - Countries are in `conditions.regionsCondition.regions` → `MarketRegionCountry { code currency { currencyCode } }`. `Market.regions` is deprecated.
- **Detect fixed prices:**
  - `Market.catalogs` returns `MarketCatalog { status publication priceList { currency fixedPricesCount parent { adjustment { type value } } } }`.
  - `fixedPricesCount > 0` means at least one variant has a fixed price in that market. `parent.adjustment` holds the percentage adjustment.
  - `Market.priceList` is **deprecated**: "Use `catalogs` instead".
  - Fixed prices themselves: `priceList(id:) { prices(first:, originType: FIXED) { nodes { price compareAtPrice variant { id } } } }`.
  - Several catalogs can apply to one market, and the lowest price wins. Source: https://shopify.dev/docs/apps/build/markets/catalogs-different-markets
- **There are no webhooks for catalog or price-list changes** (same source). Re-sync on a schedule. `markets/create|update|delete` webhooks do exist.

### `contextualPricing` ✅
`admin/variant-contextual-pricing.graphql`
```graphql
query VariantContextualPricing($id: ID!, $country: CountryCode!) {
  productVariant(id: $id) {
    id
    contextualPricing(context: { country: $country }) {
      price {
        amount
        currencyCode
      }
      compareAtPrice {
        amount
        currencyCode
      }
      unitPrice {
        amount
        currencyCode
      }
    }
  }
}
```
- `ProductVariantContextualPricing` fields:
  - `price: MoneyV2!`, `compareAtPrice: MoneyV2`, `unitPrice: MoneyV2`
  - `quantityRule: QuantityRule!`, `quantityPriceBreaks(...)`, `auditTrail: PricingAuditTrail!`
- `ContextualPricingContext` input: `country: CountryCode`, `companyLocationId: ID`, `locationId: ID`.
- Since 2025-04, only **active** markets count toward the price.
- `ProductVariant.presentmentPrices` is deprecated in favour of `contextualPricing`.
- `Product.contextualPricing(context:)` also exists. It returns `{ priceRange minVariantPricing maxVariantPricing fixedQuantityRulesCount }`.

Bulk form (aliases, one per market country) ✅ schema-valid:
`admin/bulk-inner-variant-contextual-pricing.graphql`
```graphql
query BulkInnerVariantContextualPricing {
  productVariants(query: "product_status:active AND published_status:published") {
    edges {
      node {
        id
        product {
          id
        }
        ctx_CA: contextualPricing(context: { country: CA }) {
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
        }
        ctx_GB: contextualPricing(context: { country: GB }) {
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
        }
      }
    }
  }
}
```
- **UNVERIFIED:** whether bulk accepts `contextualPricing`. The field is an object, not a connection, so the bulk rules allow it on paper. Expect a cost or timeout risk with many aliases. Test on a dev store with 2–3 countries first.

---

## 9. Storefront access token ✅
`admin/storefront-access-token-create.graphql`
```graphql
mutation StorefrontAccessTokenCreate($input: StorefrontAccessTokenInput!) {
  storefrontAccessTokenCreate(input: $input) {
    storefrontAccessToken {
      id
      title
      accessToken
      createdAt
      accessScopes {
        handle
      }
    }
    userErrors {
      field
      message
    }
  }
}
```
`admin/storefront-access-tokens.graphql`
```graphql
query StorefrontAccessTokens {
  shop {
    storefrontAccessTokens(first: 100) {
      nodes {
        id
        title
        createdAt
        accessScopes {
          handle
        }
      }
    }
  }
}
```
`admin/storefront-access-token-delete.graphql`
```graphql
mutation StorefrontAccessTokenDelete($input: StorefrontAccessTokenDeleteInput!) {
  storefrontAccessTokenDelete(input: $input) {
    deletedStorefrontAccessTokenId
    userErrors {
      field
      message
    }
  }
}
```
- The input is just `StorefrontAccessTokenInput { title: String! }`.
- The token gets the app's **unauthenticated** scopes. The app must request `unauthenticated_read_product_listings` (plus any others it needs) in `shopify.app.toml`. The documented example response shows `unauthenticated_read_product_listings`, `…_checkouts` and `…_selling_plans`. Source: https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/storefrontAccessTokenCreate
- **The list query is on `shop.storefrontAccessTokens`, not on `QueryRoot`.**
- The limit is 100 active tokens per shop per app.

---

## 10. Metafield definitions ✅
`admin/metafield-definitions.graphql`
```graphql
query ProductMetafieldDefinitions($cursor: String) {
  metafieldDefinitions(ownerType: PRODUCT, first: 250, after: $cursor, pinnedStatus: ANY) {
    nodes {
      id
      namespace
      key
      name
      description
      type {
        name
        category
      }
      access {
        storefront
      }
      capabilities {
        adminFilterable {
          enabled
        }
        smartCollectionCondition {
          enabled
        }
      }
      pinnedPosition
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```
- **Signature:** `metafieldDefinitions(ownerType: MetafieldOwnerType!, namespace, key, pinnedStatus: MetafieldDefinitionPinnedStatus = ANY, constraintStatus, constraintSubtype, query, sortKey: MetafieldDefinitionSortKeys = ID, …)`.
- `ownerType` is **required**, and the validator rejects the query without it.
- `pinnedStatus` exists, with values `ANY PINNED UNPINNED`.
- `query` accepts the filters `created_at id key namespace owner_type type updated_at`.
- Sort keys: `ID NAME PINNED_POSITION RELEVANCE`.
- **Useful for a search app:**
  - `access.storefront` tells you whether the metafield is visible on the storefront.
  - `capabilities.adminFilterable` and `capabilities.smartCollectionCondition` are also available.
  - `type.valueType` is deprecated. Use `type.name`.
- `Product.metafieldDefinitions` is deprecated. Use the root query.

---

## 11. Translations
Paginated (non-bulk) ✅:
`admin/product-translations.graphql`
```graphql
query ProductTranslations($resourceType: TranslatableResourceType!, $locale: String!, $cursor: String) {
  translatableResources(first: 100, after: $cursor, resourceType: $resourceType) {
    nodes {
      resourceId
      translations(locale: $locale) {
        key
        value
        locale
        outdated
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```
- Pass `$resourceType: PRODUCT` (also useful: `COLLECTION`, `PRODUCT_OPTION`, `PRODUCT_OPTION_VALUE`).
- Field `key`s are `title`, `body_html`, `handle`, `meta_title`, `meta_description`, and so on. **UNVERIFIED** for 2026-10, as the key names were not re-checked.
- `translations(locale:, marketId:, outdated:)`.
- `TranslatableResource` does **not** implement `Node`, so `translatableResources` **can't be the connection of a bulk query**.

Bulk-able form: `Product.translations(locale:)` is a plain list field (`[Translation!]!`), so alias it once per locale inside the products bulk query ✅ schema-valid:
`admin/bulk-inner-product-translations.graphql`
```graphql
query BulkInnerProductTranslations {
  products(query: "status:active AND published_status:published") {
    edges {
      node {
        id
        tr_fr: translations(locale: "fr") {
          key
          value
          outdated
        }
        tr_de: translations(locale: "de") {
          key
          value
          outdated
        }
      }
    }
  }
}
```
- `Translation { key value locale outdated updatedAt market }`. Use the `marketId` argument for market-specific translations.
- **UNVERIFIED** at runtime, as it has not been tested in an actual bulk run.

---

## 12. Billing / managed pricing (now "Shopify App Pricing")
Admin API (valid, but see the warning below) ✅:
`admin/current-app-installation-billing.graphql`
```graphql
query CurrentAppInstallationBilling {
  currentAppInstallation {
    id
    activeSubscriptions {
      id
      name
      status
      test
      trialDays
      currentPeriodEnd
      lineItems {
        id
        plan {
          pricingDetails {
            __typename
            ... on AppRecurringPricing {
              planHandle
              interval
              price {
                amount
                currencyCode
              }
            }
            ... on AppUsagePricing {
              terms
              interval
              cappedAmount {
                amount
                currencyCode
              }
              balanceUsed {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
}
```
- `AppSubscription { name status lineItems { plan { pricingDetails } } currentPeriodEnd trialDays test }`.
- `AppSubscriptionStatus` values: `ACTIVE CANCELLED DECLINED EXPIRED FROZEN PENDING`. `ACCEPTED` is deprecated.
- `pricingDetails` is a union of `AppRecurringPricing` and `AppUsagePricing`. `AppRecurringPricing` has `planHandle`, `interval`, `price` and `discount`.
- `AppInstallation.subscriptions` is deprecated. Use `activeSubscriptions`.

**⚠️ Current guidance** (https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing and https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/migrating-to-shopify-app-pricing):
- For apps on Shopify App Pricing (formerly "managed pricing"), Shopify says: "Replace GraphQL Admin API checks, such as `billing.check()` and `currentAppInstallation`, with Partner API queries."
- Also: "Shopify App Pricing doesn't send Billing API webhooks."
- The canonical check is the Partner API (validated against `api: partner`, `2026-10`) ✅:
`admin/partner-active-subscription.graphql`
```graphql
query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    cancelAtEndOfCycle
    trialEndsAt
    legacySubscriptionId
    currentBillingCycle {
      startTime
      endTime
    }
    items {
      handle
      description
    }
    pendingUpdate {
      billingPeriod
      items {
        handle
      }
    }
  }
}
```
- `activeSubscription` returns `null` when the shop has no managed-pricing contract.
- It needs a Partner API client with the **Manage apps** permission, and it works for public apps only.
- `appId` and `shopId` are GIDs (`gid://shopify/App/…`, `gid://shopify/Shop/…`).
- `items.handle` is "the plan or event handle".

**Plan-selection page URL:**
- The docs' code builds it from `storeHandle = session.shop.replace(".myshopify.com", "")` and `appHandle` (the `handle` in `shopify.app.toml`). It redirects with `target: "_top"`, because the page is outside the app iframe.
- The literal template string was stripped from the doc-search output, so the exact form `https://admin.shopify.com/store/{store_handle}/charges/{app_handle}/pricing_plans` is **UNVERIFIED**. It is consistent with the variables the code uses. Source: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page
- After approval, the merchant goes to the plan's **welcome link**, with `plan_handle` (and, for apps without App Home, the shop domain) appended as URL parameters.

---

## 13. Web pixel ✅
`admin/web-pixel-create.graphql`
```graphql
mutation WebPixelCreate($webPixel: WebPixelInput!) {
  webPixelCreate(webPixel: $webPixel) {
    webPixel {
      id
      settings
    }
    userErrors {
      field
      message
      code
    }
  }
}
```
`admin/web-pixel-update.graphql`
```graphql
mutation WebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
  webPixelUpdate(id: $id, webPixel: $webPixel) {
    webPixel {
      id
      settings
    }
    userErrors {
      field
      message
      code
    }
  }
}
```
`admin/web-pixel.graphql`
```graphql
query WebPixel {
  webPixel {
    id
    settings
  }
}
```
- `WebPixelInput { settings: JSON! }`. The documented example passes an object (`{"webPixel":{"settings":{"trackingId":"…"}}}`), and the response's `settings` comes back as a JSON string.
- Settings are validated against the extension's `shopify.extension.toml` settings definition.
- Error codes include `INVALID_SETTINGS`, `TAKEN` (a pixel already exists, so call `webPixelUpdate`), `NO_EXTENSION` and `INVALID_CONFIGURATION_JSON`.
- `webPixel(id: ID)`: the `id` is optional. Without it, the query returns the app's pixel. **UNVERIFIED** at runtime.
- Scopes: `write_pixels` and `read_customer_events`. Source: https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/webPixelCreate

---

## 14. Rate limiting
Source: https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits

**Response shape:**
```json
"extensions": { "cost": { "requestedQueryCost": 101, "actualQueryCost": 46,
  "throttleStatus": { "maximumAvailable": 1000, "currentlyAvailable": 954, "restoreRate": 50 } } }
```
- Before a query runs, the bucket must have room for `requestedQueryCost`. The difference to `actualQueryCost` is refunded afterwards.
- The header `Shopify-GraphQL-Cost-Debug=1` adds a per-field `fields[]` breakdown.

**Restore rates by plan:**

| Plan | Restore rate |
|---|---|
| Standard | 100 points/s |
| Advanced | 200 points/s |
| Plus | 1,000 points/s |
| Enterprise (Commerce Components) | 2,000 points/s |

- The bucket size per plan is not given on the page in 2026-10 (**UNVERIFIED**). Read `throttleStatus.maximumAvailable` at runtime.
- The **single-query maximum is 1,000 points** on every plan, and input arrays are limited to 250 items.

**Throttled response:**
- It comes back as **HTTP 200** (not 429). `errors[n].extensions.code == "THROTTLED"`, with the bucket state in the top-level `extensions.cost.throttleStatus`.
- Back off using `restoreRate`. There is no `windowResetAt` for the Admin bucket. Sources: https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api/errors-limits-and-performance and the Admin API reference.
- A cost over the 1,000 maximum returns a different error:
```json
{ "errors": [ { "message": "Query cost is 2003, which exceeds the single query max cost limit (1000). …",
  "extensions": { "code": "MAX_COST_EXCEEDED", "cost": 2003, "maxCost": 1000, "documentation": "…" } } ] }
```
- Bulk query execution doesn't count against the bucket. Only `bulkOperationRunQuery` itself (a mutation, about 10 points) and the polling requests do.

---

## Webhook topics confirmed in `WebhookSubscriptionTopic` (2026-10)
- **Bulk:** `BULK_OPERATIONS_FINISH`
- **Products:** `PRODUCTS_CREATE/UPDATE/DELETE`, `PRODUCT_LISTINGS_ADD/UPDATE/REMOVE`, `PRODUCT_PUBLICATIONS_CREATE/UPDATE/DELETE`, `SCHEDULED_PRODUCT_LISTINGS_ADD/UPDATE/REMOVE`
- **Collections:** `COLLECTIONS_CREATE/UPDATE/DELETE`, `COLLECTION_LISTINGS_ADD/UPDATE/REMOVE`, `COLLECTION_PUBLICATIONS_CREATE/UPDATE/DELETE`
- **Inventory:** `INVENTORY_LEVELS_UPDATE/CONNECT/DISCONNECT`, `INVENTORY_ITEMS_CREATE/UPDATE/DELETE`
- **Markets:** `MARKETS_CREATE/UPDATE/DELETE`
- **Locales:** `LOCALES_CREATE/UPDATE/DESTROY`
- **Metafield definitions:** `METAFIELD_DEFINITIONS_CREATE/UPDATE/DELETE`
- **Shop and app:** `SHOP_UPDATE`, `APP_UNINSTALLED`, `APP_SUBSCRIPTIONS_UPDATE` (not sent for Shopify App Pricing)
