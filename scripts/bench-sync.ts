// Benchmark full sync (task 1.3).
//   Tổng hợp (không cần Shopify): npx tsx scripts/bench-sync.ts --products 30000 [--variants 5] [--metafields 10] [--shards 1]
//   Store thật:                   npx tsx scripts/bench-sync.ts --live --shop x.myshopify.com --token shpat_... [--shards 2]
// Đo: thời gian chờ bulk (Shopify), tải+parse+join, map+import, RAM đỉnh. Import vào collection tạm rồi xoá.
import { parseArgs } from "node:util";
import { FakeShopify, instantClock } from "../test/fakes/fake-shopify";
import { buildProductSchema } from "../app/lib/search/index-schema";
import { TypesenseEngine } from "../app/lib/search/typesense-engine";
import { GraphqlExecutor, fetchTransport, realClock } from "../app/lib/shopify/graphql";
import { BulkRunner, catalogStats, planShards } from "../app/lib/sync/bulk-runner";
import {
  assembleDocs,
  buildFullSyncSpecs,
  importInBatches,
  nestedSpec,
} from "../app/lib/sync/pipeline";
import { PRODUCT_FILTER } from "../app/lib/sync/queries";
import { PrismaClient } from "@prisma/client";
import { MemoryStaging, PgStaging, type Staging } from "../app/lib/sync/staging";

const { values: a } = parseArgs({
  options: {
    products: { type: "string", default: "30000" },
    variants: { type: "string", default: "5" },
    metafields: { type: "string", default: "10" },
    shards: { type: "string", default: "1" },
    live: { type: "boolean", default: false },
    shop: { type: "string" },
    token: { type: "string" },
    batch: { type: "string", default: "1000" },
    concurrency: { type: "string", default: "3" },
    staging: { type: "string", default: "memory" },
    nested: { type: "boolean", default: false },
  },
});

const N = Number(a.products);
const V = Number(a.variants);
const M = Number(a.metafields);
const metafields = Array.from({ length: M }, (_, i) => ({
  namespace: "custom",
  key: `attr_${i}`,
  type: i % 3 === 0 ? "number_integer" : "single_line_text_field",
}));

const COLORS = ["Red", "Blue", "Green", "Black", "White", "Navy", "Grey"];
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const VENDORS = Array.from({ length: 40 }, (_, i) => `Brand ${i}`);
const WORDS =
  "classic slim relaxed cotton linen wool denim summer winter vintage premium soft organic".split(
    " ",
  );

async function* productsJsonl() {
  const lines: string[] = [];
  for (let i = 1; i <= N; i++) {
    const w = (k: number) => WORDS[(i * 7 + k) % WORDS.length];
    const p: Record<string, unknown> = {
      id: `gid://shopify/Product/${i}`,
      handle: `product-${i}`,
      title: `${w(1)} ${w(2)} item ${i}`,
      vendor: VENDORS[i % VENDORS.length],
      productType: ["Shirts", "Pants", "Shoes", "Hats"][i % 4],
      tags: [w(3), w(4), `tag-${i % 50}`],
      status: "ACTIVE",
      description: `${w(5)} ${w(6)} ${w(7)} product number ${i}. `.repeat(8),
      createdAt: new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString(),
      publishedAt: new Date(Date.UTC(2020, 0, 2) + i * 60_000).toISOString(),
      updatedAt: "2026-10-20T00:00:00Z",
      onlineStoreUrl: `https://x/products/product-${i}`,
      totalInventory: (i * 13) % 100,
      featuredMedia: {
        preview: { image: { url: `https://cdn.shopify.com/p/${i}.jpg`, altText: null } },
      },
      options: [
        { name: "Size", values: SIZES.slice(0, Math.min(V, SIZES.length)) },
        { name: "Color", values: [COLORS[i % COLORS.length]] },
      ],
      priceRangeV2: {
        minVariantPrice: { amount: "10.0", currencyCode: "USD" },
        maxVariantPrice: { amount: "99.0", currencyCode: "USD" },
      },
      compareAtPriceRange: { maxVariantCompareAtPrice: null },
    };
    metafields.forEach((m, k) => {
      p[`mf_${k}`] = {
        value: m.type === "number_integer" ? String((i + k) % 500) : `${w(k)} ${k}`,
        type: m.type,
      };
    });
    lines.push(JSON.stringify(p));
    if (lines.length === 500) yield lines.splice(0).join("\n") + "\n";
  }
  if (lines.length) yield lines.join("\n") + "\n";
}

async function* variantsJsonl() {
  const lines: string[] = [];
  // Xen kẽ thứ tự (không theo product) để kiểm tra join theo ID.
  for (let k = 0; k < V; k++) {
    for (let i = 1; i <= N; i++) {
      const price = (10 + ((i + k * 3) % 90)).toFixed(2);
      lines.push(
        JSON.stringify({
          id: `gid://shopify/ProductVariant/${i * 10 + k}`,
          product: { id: `gid://shopify/Product/${i}` },
          title: `${SIZES[k % SIZES.length]} / ${COLORS[i % COLORS.length]}`,
          sku: `SKU-${i}-${k}`,
          barcode: null,
          price,
          compareAtPrice: k === 0 && i % 5 === 0 ? (Number(price) * 1.3).toFixed(2) : null,
          availableForSale: (i + k) % 7 !== 0,
          inventoryQuantity: (i + k) % 20,
          position: k + 1,
          selectedOptions: [
            { name: "Size", value: SIZES[k % SIZES.length] },
            { name: "Color", value: COLORS[i % COLORS.length] },
          ],
        }),
      );
      if (lines.length === 1000) yield lines.splice(0).join("\n") + "\n";
    }
  }
  if (lines.length) yield lines.join("\n") + "\n";
}

async function* collectionsJsonl() {
  const C = 50;
  for (let c = 1; c <= C; c++) {
    const lines = [
      JSON.stringify({
        id: `gid://shopify/Collection/${c}`,
        handle: `c-${c}`,
        title: `Collection ${c}`,
        sortOrder: c <= 10 ? "MANUAL" : "BEST_SELLING",
      }),
    ];
    for (let i = c; i <= N; i += C / 5) {
      lines.push(
        JSON.stringify({
          id: `gid://shopify/Product/${Math.floor(i)}`,
          __parentId: `gid://shopify/Collection/${c}`,
        }),
      );
    }
    yield lines.join("\n") + "\n";
  }
}

let peakRss = 0;
let peakHeap = 0;
const sampler = setInterval(() => {
  const m = process.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
  peakHeap = Math.max(peakHeap, m.heapUsed);
}, 50);
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)} MB`;

async function main() {
  const engine = new TypesenseEngine({
    host: process.env.TYPESENSE_HOST ?? "localhost",
    port: Number(process.env.TYPESENSE_PORT ?? 8108),
    protocol: (process.env.TYPESENSE_PROTOCOL as "http" | "https") ?? "http",
    apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
    connectionTimeoutSeconds: 60,
  });

  let runner: BulkRunner;
  let shards: (string | undefined)[] = [undefined];
  if (a.live) {
    if (!a.shop || !a.token) throw new Error("--live needs --shop and --token");
    const ex = new GraphqlExecutor(fetchTransport(a.shop, a.token), realClock);
    runner = new BulkRunner(ex);
    const stats = await catalogStats(ex, PRODUCT_FILTER);
    shards =
      Number(a.shards) > 1
        ? planShards(stats.count, stats.oldest, stats.newest, {
            threshold: 1,
            maxShards: Number(a.shards),
          })
        : [undefined];
    console.log(`live catalog: ${stats.count} products, shards: ${shards.length}`);
  } else {
    const fake = new FakeShopify({
      products: productsJsonl,
      productVariants: variantsJsonl,
      collections: collectionsJsonl,
    });
    fake.pollsUntilDone = 0;
    const clock = instantClock();
    runner = new BulkRunner(new GraphqlExecutor(fake.transport, clock), {
      fetchImpl: fake.fetch,
      clock,
    });
  }

  const name = `bench_${Date.now()}`;
  await engine.createCollection(buildProductSchema({ name, locales: [], metafields }));
  const prisma = a.staging === "pg" ? new PrismaClient() : undefined;
  const staging: Staging = prisma ? new PgStaging(prisma, name) : new MemoryStaging();
  const t0 = performance.now();
  const specs = a.nested
    ? [nestedSpec(staging, metafields)]
    : buildFullSyncSpecs({ staging, metafields, shards });
  const results = await runner.run(specs);
  const t1 = performance.now();
  const heapBulks = peakHeap;
  console.error(`bulks done in ${Math.round(t1 - t0)}ms`);
  peakHeap = 0;
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) {
    g();
    console.log(`retained after bulks (staging): heapUsed=${mb(process.memoryUsage().heapUsed)}`);
  }
  const stats = await importInBatches(
    engine,
    name,
    assembleDocs(staging, { currency: "USD", metafields }),
    {
      batchSize: Number(a.batch),
      concurrency: Number(a.concurrency),
    },
  );
  const t2 = performance.now();
  const count = (await engine.getCollection(name))?.numDocuments;
  const staged = await staging.count();
  await staging.clear();
  await prisma?.$disconnect();
  await engine.dropCollection(name);
  clearInterval(sampler);

  const report = {
    mode: a.live ? "live" : "synthetic",
    layout: a.nested ? "nested" : shards.length > 1 ? "flat+shard" : "flat",
    staging: a.staging,
    products: staged,
    variantsPerProduct: V,
    metafields: M,
    shards: shards.length,
    bulks: results.map((r) => ({
      name: r.name,
      rows: r.rows,
      waitMs: Math.round(r.waitMs),
      processMs: Math.round(r.processMs),
    })),
    fetchParseJoinMs: Math.round(t1 - t0),
    mapImportMs: Math.round(t2 - t1),
    totalMs: Math.round(t2 - t0),
    imported: stats.imported,
    failed: stats.failed,
    indexed: count,
    peakRss: mb(peakRss),
    peakHeapBulks: mb(heapBulks),
    peakHeapImport: mb(peakHeap),
    firstErrors: stats.errors.slice(0, 3),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
