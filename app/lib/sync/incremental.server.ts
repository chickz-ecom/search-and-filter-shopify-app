import type { Redis } from "ioredis";
import type { SearchEngine } from "../search/engine";
import type { MetafieldSpec } from "../search/index-schema";
import { productAlias } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import {
  fixedPriceCountries,
  loadShopConfig,
  requiredMetafields,
  type Db,
} from "../shop/shop.server";
import type { GraphqlExecutor } from "../shopify/graphql";
import { fullSyncTargetKey } from "./full-sync.server";
import {
  gidToId,
  isIndexable,
  mapProduct,
  type CollectionMembership,
  type ProductNode,
  type VariantNode,
} from "./mapper";
import { fetchProductMetafieldDefinitions, resolveMetafieldSpecs } from "./metafields.server";
import {
  COLLECTIONS_BATCH,
  CORE_BATCH,
  COST,
  PRODUCT_COLLECTIONS_BY_IDS_QUERY,
  productsCoreByIdsQuery,
  variantsByProductIdsQuery,
} from "./queries";

// Incremental (task 1.7, mục 5.2): gom ID → nodes(ids:) theo lô → upsert / xoá. Lấy bản mới nhất nên
// không phụ thuộc thứ tự webhook. Field không lấy lại ở đây (pos_*, best_selling_rank, giá theo market,
// bản dịch) được giữ từ document cũ; job collection / đêm cập nhật chúng.

export type IncrementalDeps = {
  db: Db;
  engine: SearchEngine;
  ex: GraphqlExecutor;
  redis?: Redis;
};

const productGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`);
const chunk = <T>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Collection nhận ghi: alias + collection của full sync đang chạy (mục 5.1 bước 8). */
export async function writeTargets(
  shopId: string,
  deps: Pick<IncrementalDeps, "redis">,
): Promise<string[]> {
  const targets = [productAlias(shopId)];
  const building = await deps.redis?.get(fullSyncTargetKey(shopId));
  if (building) targets.push(building);
  return targets;
}

const CARRY_OVER = /^(pos_|price_min_.+|title_|description_|tags_)|^best_selling_rank$/;

/** Giữ field không lấy lại được ở incremental từ document cũ. */
export function carryOver(next: ProductDoc, prev: Record<string, unknown> | null): ProductDoc {
  if (!prev) return next;
  const memberOf = new Set(next.collections);
  for (const [k, v] of Object.entries(prev)) {
    if (!CARRY_OVER.test(k) || k in next || v === undefined || v === null) continue;
    if (k === "price_min" || k === "price_max") continue;
    // pos_{id} chỉ còn ý nghĩa khi product vẫn thuộc collection đó.
    if (k.startsWith("pos_") && !memberOf.has(k.slice(4))) continue;
    (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

async function fetchCore(ex: GraphqlExecutor, gids: string[], metafields: MetafieldSpec[]) {
  type R = { nodes: (({ __typename: string } & ProductNode) | null)[] };
  const d = await ex.query<R>(
    productsCoreByIdsQuery(metafields),
    { ids: gids },
    {
      estimatedCost: COST.coreBase + gids.length * (COST.corePerProduct + metafields.length),
    },
  );
  const out = new Map<string, ProductNode>();
  // nodes trả theo vị trí, có thể null → map theo id, không theo thứ tự.
  for (const n of d.nodes) if (n && n.__typename === "Product") out.set(n.id, n);
  return out;
}

async function fetchVariants(
  ex: GraphqlExecutor,
  productIds: string[],
  priceCountries: string[] = [],
) {
  const out = new Map<string, VariantNode[]>();
  let cursor: string | null = null;
  const query = `product_ids:${productIds.join(",")}`;
  for (let page = 0; page < 40; page++) {
    type R = {
      productVariants: {
        nodes: VariantNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    const d: R = await ex.query<R>(
      variantsByProductIdsQuery(priceCountries),
      { query, cursor },
      { estimatedCost: COST.variantsPage },
    );
    for (const v of d.productVariants.nodes) {
      const list = out.get(v.product.id) ?? [];
      list.push(v);
      out.set(v.product.id, list);
    }
    if (!d.productVariants.pageInfo.hasNextPage) break;
    cursor = d.productVariants.pageInfo.endCursor;
  }
  return out;
}

async function fetchCollections(ex: GraphqlExecutor, gids: string[]) {
  const out = new Map<string, CollectionMembership[]>();
  for (const part of chunk(gids, COLLECTIONS_BATCH)) {
    type R = {
      nodes: ({
        id: string;
        collections?: { nodes: { id: string; handle: string; title: string }[] };
      } | null)[];
    };
    const d = await ex.query<R>(
      PRODUCT_COLLECTIONS_BY_IDS_QUERY,
      { ids: part },
      {
        estimatedCost: part.length * COST.collectionsPerProduct,
      },
    );
    for (const n of d.nodes) {
      if (!n?.collections) continue;
      out.set(
        n.id,
        n.collections.nodes.map((c) => ({
          id: gidToId(c.id),
          handle: c.handle,
          title: c.title,
          manual: false,
        })),
      );
    }
  }
  return out;
}

/** Gộp field giữ lại từ document hiện có (song song, giới hạn đồng thời). */
export async function withCarryOver(
  engine: SearchEngine,
  collection: string,
  docs: ProductDoc[],
  concurrency = 16,
) {
  const out: ProductDoc[] = new Array(docs.length);
  let i = 0;
  const worker = async () => {
    while (i < docs.length) {
      const k = i++;
      const prev = await engine
        .getDocument<Record<string, unknown>>(collection, docs[k].id)
        .catch(() => null);
      out[k] = carryOver(docs[k], prev);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, docs.length) }, worker));
  return out;
}

export async function shopMetafields(
  db: Db,
  ex: GraphqlExecutor,
  shopId: string,
): Promise<MetafieldSpec[]> {
  const refs = requiredMetafields(await loadShopConfig(db, shopId));
  return refs.length ? resolveMetafieldSpecs(refs, await fetchProductMetafieldDefinitions(ex)) : [];
}

export type RefreshResult = { upserted: number; deleted: number };

/** Lấy lại các product theo ID và đồng bộ với engine. */
export async function refreshProducts(
  shopId: string,
  productIds: string[],
  deps: IncrementalDeps,
  ctx?: { currency: string; metafields: MetafieldSpec[]; priceCountries?: string[] },
): Promise<RefreshResult> {
  if (!productIds.length) return { upserted: 0, deleted: 0 };
  const shop = await deps.db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const metafields = ctx?.metafields ?? (await shopMetafields(deps.db, deps.ex, shopId));
  const currency = ctx?.currency ?? shop.currency;
  const priceCountries = ctx?.priceCountries ?? fixedPriceCountries(shop);
  const targets = await writeTargets(shopId, deps);
  const result: RefreshResult = { upserted: 0, deleted: 0 };

  for (const part of chunk([...new Set(productIds.map((id) => gidToId(id)))], CORE_BATCH)) {
    const gids = part.map(productGid);
    const core = await fetchCore(deps.ex, gids, metafields);
    const keep = gids.filter((g) => isIndexable(core.get(g)));
    const remove = part.filter((id) => !keep.includes(productGid(id)));
    const keepIds = keep.map(gidToId);
    const [variants, collections] = keep.length
      ? await Promise.all([
          fetchVariants(deps.ex, keepIds, priceCountries),
          fetchCollections(deps.ex, keep),
        ])
      : [new Map<string, VariantNode[]>(), new Map<string, CollectionMembership[]>()];

    const docs = await withCarryOver(
      deps.engine,
      targets[0],
      keep.map((g) =>
        mapProduct(core.get(g)!, variants.get(g) ?? [], {
          currency,
          metafields,
          collections: collections.get(g) ?? [],
          priceCountries,
        }),
      ),
    );
    for (const t of targets) {
      if (docs.length) await deps.engine.importDocuments(t, docs, "upsert");
      if (remove.length) await deps.engine.deleteDocuments(t, remove);
    }
    result.upserted += docs.length;
    result.deleted += remove.length;
  }
  await deps.db.shop
    .update({ where: { id: shopId }, data: { lastIncrementalAt: new Date() } })
    .catch(() => undefined);
  return result;
}

export async function deleteProducts(
  shopId: string,
  productIds: string[],
  deps: Pick<IncrementalDeps, "engine" | "redis">,
) {
  const ids = productIds.map((id) => gidToId(id));
  let deleted = 0;
  for (const t of await writeTargets(shopId, deps))
    deleted = Math.max(deleted, await deps.engine.deleteDocuments(t, ids));
  return deleted;
}

export const INVENTORY_ITEMS_QUERY = `query InventoryItemsToProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    id
    ... on InventoryItem {
      variants(first: 5) { nodes { product { id } } }
    }
  }
}`;

/** inventory_item_id → product ID (inventory_levels/update chỉ có item). */
export async function inventoryItemsToProducts(
  ex: GraphqlExecutor,
  itemIds: string[],
): Promise<string[]> {
  const products = new Set<string>();
  for (const part of chunk([...new Set(itemIds)], 50)) {
    type R = {
      nodes: ({ id: string; variants?: { nodes: { product: { id: string } }[] } } | null)[];
    };
    const d = await ex.query<R>(
      INVENTORY_ITEMS_QUERY,
      {
        ids: part.map((id) => (id.startsWith("gid://") ? id : `gid://shopify/InventoryItem/${id}`)),
      },
      { estimatedCost: 2 + part.length * 12 },
    );
    for (const n of d.nodes)
      for (const v of n?.variants?.nodes ?? []) products.add(gidToId(v.product.id));
  }
  return [...products];
}
