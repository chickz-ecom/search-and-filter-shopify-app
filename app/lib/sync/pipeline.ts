import type { ImportResult, SearchEngine } from "../search/engine";
import type { MetafieldSpec } from "../search/index-schema";
import type { ProductDoc } from "../search/product-doc";
import type { BulkSpec } from "./bulk-runner";
import { gidToId, mapProduct, type MapOptions, type ProductNode, type VariantNode } from "./mapper";
import {
  bulkCollectionsQuery,
  bulkNestedQuery,
  bulkProductsQuery,
  bulkVariantsQuery,
} from "./queries";
import type { Staging } from "./staging";

// Ghép (a) products + (b) variants + (c) collections theo ID rồi import theo batch (mục 5.1 bước 2–4).

type CollectionRow = {
  id: string;
  handle?: string;
  title?: string;
  sortOrder?: string;
  __parentId?: string;
};

export type FullSyncSpecInput = {
  staging: Staging;
  metafields: MetafieldSpec[];
  /** Filter shard theo created_at; [undefined] = không shard. */
  shards: (string | undefined)[];
};

/** Tạo danh sách bulk: products × shards, variants × shards, collections (grouped). */
export function buildFullSyncSpecs(input: FullSyncSpecInput): BulkSpec<never>[] {
  const { staging, metafields, shards } = input;
  const specs: BulkSpec<never>[] = [];
  shards.forEach((filter, i) => {
    specs.push({
      name: shards.length > 1 ? `products#${i + 1}` : "products",
      query: bulkProductsQuery(metafields, filter),
      onRow: ((row: ProductNode) => staging.putProduct(row)) as never,
    });
  });
  shards.forEach((filter, i) => {
    specs.push({
      name: shards.length > 1 ? `variants#${i + 1}` : "variants",
      query: bulkVariantsQuery(filter),
      onRow: ((row: VariantNode) => staging.addVariant(row)) as never,
    });
  });
  specs.push(collectionsSpec(staging));
  return specs;
}

export function collectionsSpec(staging: Staging): BulkSpec<never> {
  const collections = new Map<
    string,
    { id: string; handle: string; title: string; manual: boolean; next: number }
  >();
  const orphans: CollectionRow[] = [];
  const attach = (row: CollectionRow) => {
    const c = collections.get(row.__parentId!);
    if (!c) return false;
    c.next += 1;
    staging.addCollection(row.id, {
      id: c.id,
      handle: c.handle,
      title: c.title,
      manual: c.manual,
      position: c.next,
    });
    return true;
  };
  return {
    name: "collections",
    query: bulkCollectionsQuery(),
    groupObjects: true,
    onRow: ((row: CollectionRow) => {
      if (!row.__parentId) {
        collections.set(row.id, {
          id: gidToId(row.id),
          handle: row.handle ?? "",
          title: row.title ?? "",
          manual: row.sortOrder === "MANUAL",
          next: 0,
        });
        // Dòng con đến trước cha (không nên xảy ra ở dạng grouped) → gắn lại.
        for (let i = orphans.length - 1; i >= 0; i--) {
          if (orphans[i].__parentId === row.id && attach(orphans[i])) orphans.splice(i, 1);
        }
        return;
      }
      if (!attach(row)) orphans.push(row);
    }) as never,
  };
}

export type AssembleOptions = Omit<
  MapOptions,
  "collections" | "bestSellingRank" | "translations" | "marketPrices"
> & {
  bestSelling?: Map<string, number>;
  translations?: Map<string, MapOptions["translations"]>;
  marketPrices?: Map<string, Record<string, number>>;
};

export async function* assembleDocs(
  staging: Staging,
  opts: AssembleOptions,
): AsyncIterable<ProductDoc> {
  for await (const { product, variants, collections } of staging.entries()) {
    const id = gidToId(product.id);
    yield mapProduct(product, variants, {
      currency: opts.currency,
      metafields: opts.metafields,
      collections,
      bestSellingRank: opts.bestSelling?.get(id),
      translations: opts.translations?.get(id),
      marketPrices: opts.marketPrices?.get(id),
    });
  }
}

export type ImportStats = {
  imported: number;
  failed: number;
  batches: number;
  errors: ImportResult["errors"];
};

/** Import theo batch (mặc định 1.000) với 2–4 luồng song song (mục 5.1 bước 4). */
export async function importInBatches(
  engine: SearchEngine,
  collection: string,
  docs: Iterable<ProductDoc> | AsyncIterable<ProductDoc>,
  opts: { batchSize?: number; concurrency?: number; onProgress?: (imported: number) => void } = {},
): Promise<ImportStats> {
  const batchSize = opts.batchSize ?? 1000;
  const concurrency = opts.concurrency ?? 3;
  const stats: ImportStats = { imported: 0, failed: 0, batches: 0, errors: [] };
  const inflight = new Set<Promise<void>>();
  let batch: ProductDoc[] = [];
  let error: unknown;
  const flush = (b: ProductDoc[]) => {
    const p = engine.importDocuments(collection, b, "upsert").then((r) => {
      stats.imported += r.success;
      stats.failed += r.failed;
      stats.batches += 1;
      if (stats.errors.length < 50)
        stats.errors.push(...r.errors.slice(0, 50 - stats.errors.length));
      opts.onProgress?.(stats.imported);
    });
    const tracked: Promise<void> = p
      .catch((err: unknown) => {
        error ??= err;
      })
      .finally(() => inflight.delete(tracked));
    inflight.add(tracked);
  };
  for await (const doc of docs) {
    if (error) break;
    batch.push(doc);
    if (batch.length >= batchSize) {
      flush(batch);
      batch = [];
      if (inflight.size >= concurrency) await Promise.race(inflight);
    }
  }
  if (batch.length && !error) flush(batch);
  await Promise.all(inflight);
  if (error) throw error;
  return stats;
}

/** Bulk lồng một query (chỉ cho benchmark so sánh): dòng con có __parentId = product. */
export function nestedSpec(staging: Staging, metafields: MetafieldSpec[]): BulkSpec<never> {
  return {
    name: "nested",
    query: bulkNestedQuery(metafields),
    onRow: ((row: Record<string, unknown> & { id: string; __parentId?: string }) => {
      if (!row.__parentId) return staging.putProduct(row as unknown as ProductNode);
      if (row.id.includes("/ProductVariant/")) {
        return staging.addVariant({
          ...(row as unknown as VariantNode),
          product: { id: row.__parentId },
        });
      }
      if (row.id.includes("/Collection/")) {
        // Không có vị trí trong collection ở dạng lồng này (đúng hạn chế đã biết).
        return staging.addCollection(row.__parentId, {
          id: gidToId(row.id),
          handle: String(row.handle ?? ""),
          title: String(row.title ?? ""),
          manual: false,
        });
      }
    }) as never,
  };
}
