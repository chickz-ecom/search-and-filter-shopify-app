import type { ProductNode, VariantNode } from "../../app/lib/sync/mapper";
import { FakeShopify } from "./fake-shopify";

// Catalog trong bộ nhớ phục vụ các query incremental / delta / collection của FakeShopify.
// Sửa catalog (giả lập merchant sửa trong admin) rồi chạy job để kiểm tra index khớp.

export type FakeCollection = {
  id: string;
  handle: string;
  title: string;
  sortOrder: string;
  products: string[];
};

export class FakeCatalog {
  products = new Map<string, ProductNode>();
  variants = new Map<string, VariantNode[]>();
  collections = new Map<string, FakeCollection>();
  /** inventory item gid → product gid */
  inventoryItems = new Map<string, string>();
  updatedSinceCalls = 0;

  constructor(public fake: FakeShopify = new FakeShopify({})) {
    const h = fake.handlers;
    h.ProductsCoreByIds = (v) => ({
      nodes: (v.ids as string[]).map((id) => {
        const p = this.products.get(id);
        return p ? { __typename: "Product", ...p } : null;
      }),
    });
    h.VariantsByProductIds = (v) => {
      const ids = String(v.query).replace("product_ids:", "").split(",");
      return {
        productVariants: {
          nodes: ids.flatMap((id) => this.variants.get(`gid://shopify/Product/${id}`) ?? []),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    };
    h.ProductCollectionsByIds = (v) => ({
      nodes: (v.ids as string[]).map((id) =>
        this.products.has(id)
          ? {
              id,
              collections: {
                nodes: [...this.collections.values()]
                  .filter((c) => c.products.includes(id))
                  .map((c) => ({
                    id: `gid://shopify/Collection/${c.id}`,
                    handle: c.handle,
                    title: c.title,
                  })),
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            }
          : null,
      ),
    });
    h.DeltaProductsUpdatedSince = (v) => {
      this.updatedSinceCalls++;
      const since = Date.parse(/'([^']+)'/.exec(String(v.query))![1]);
      const all = [...this.products.values()]
        .filter((p) => Date.parse(p.updatedAt) > since)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const start = v.cursor ? Number(v.cursor) : 0;
      const page = all.slice(start, start + 250);
      return {
        products: {
          nodes: page.map((p) => ({
            id: p.id,
            updatedAt: p.updatedAt,
            status: p.status,
            onlineStoreUrl: p.onlineStoreUrl,
          })),
          pageInfo: { hasNextPage: start + 250 < all.length, endCursor: String(start + 250) },
        },
      };
    };
    h.InventoryItemsToProducts = (v) => ({
      nodes: (v.ids as string[]).map((id) => {
        const p = this.inventoryItems.get(id);
        return p ? { id, variants: { nodes: [{ product: { id: p } }] } } : null;
      }),
    });
    h.CollectionProductsOrdered = (v) => {
      const c = this.collections.get(String(v.id).split("/").pop()!);
      if (!c) return { collection: null };
      const start = v.cursor ? Number(v.cursor) : 0;
      return {
        collection: {
          id: `gid://shopify/Collection/${c.id}`,
          handle: c.handle,
          title: c.title,
          updatedAt: "2026-10-26T00:00:00Z",
          sortOrder: c.sortOrder,
          products: {
            nodes: c.products.slice(start, start + 250).map((id) => ({ id })),
            pageInfo: {
              hasNextPage: start + 250 < c.products.length,
              endCursor: String(start + 250),
            },
          },
        },
      };
    };
    h.ProductMetafieldDefinitions = () => ({
      metafieldDefinitions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });
  }

  /** Thêm/sửa product đơn giản (1 variant). */
  upsert(n: number, over: Partial<ProductNode> = {}, price = "10.00") {
    const id = `gid://shopify/Product/${n}`;
    const p: ProductNode = {
      id,
      handle: `p-${n}`,
      title: `Product ${n}`,
      vendor: "Acme",
      productType: "Thing",
      tags: [],
      status: "ACTIVE",
      description: "",
      createdAt: "2026-01-01T00:00:00Z",
      publishedAt: "2026-01-01T00:00:00Z",
      updatedAt: new Date().toISOString(),
      onlineStoreUrl: `https://x/products/p-${n}`,
      totalInventory: 1,
      featuredMedia: null,
      options: [{ name: "Title", values: ["Default Title"] }],
      priceRangeV2: {
        minVariantPrice: { amount: price, currencyCode: "USD" },
        maxVariantPrice: { amount: price, currencyCode: "USD" },
      },
      compareAtPriceRange: { maxVariantCompareAtPrice: null },
      ...over,
    };
    this.products.set(id, p);
    this.variants.set(id, [
      {
        id: `gid://shopify/ProductVariant/${n}`,
        product: { id },
        title: "Default Title",
        sku: `SKU-${n}`,
        barcode: null,
        price,
        compareAtPrice: null,
        availableForSale: true,
        inventoryQuantity: 1,
        position: 1,
        selectedOptions: [{ name: "Title", value: "Default Title" }],
      },
    ]);
    this.inventoryItems.set(`gid://shopify/InventoryItem/${n}`, id);
    return p;
  }
}
