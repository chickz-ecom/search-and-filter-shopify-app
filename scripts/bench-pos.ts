// Benchmark task 1.13: dung lượng/ bộ nhớ / tốc độ sort khi có nhiều pos_{collectionId} (thứ tự thủ công).
//   npx tsx scripts/bench-pos.ts --products 20000 --collections 500 --per-product 20
// --per-product: số collection MANUAL trung bình mỗi product thuộc về (worst case = --collections).
import { parseArgs } from "node:util";
import { buildProductSchema } from "../app/lib/search/index-schema";
import { TypesenseEngine } from "../app/lib/search/typesense-engine";
import type { ProductDoc } from "../app/lib/search/product-doc";
import { importInBatches } from "../app/lib/sync/pipeline";

const { values: a } = parseArgs({
  options: {
    products: { type: "string", default: "20000" },
    collections: { type: "string", default: "500" },
    "per-product": { type: "string", default: "20" },
  },
});
const N = Number(a.products);
const C = Number(a.collections);
const K = Math.min(C, Number(a["per-product"]));
const host = process.env.TYPESENSE_HOST ?? "localhost";
const port = Number(process.env.TYPESENSE_PORT ?? 8108);
const key = process.env.TYPESENSE_API_KEY ?? "dev-typesense-key";
const engine = new TypesenseEngine({
  host,
  port,
  protocol: "http",
  apiKey: key,
  connectionTimeoutSeconds: 60,
});

async function memActive(): Promise<number> {
  const r = await fetch(`http://${host}:${port}/metrics.json`, {
    headers: { "X-TYPESENSE-API-KEY": key },
  });
  const m = (await r.json()) as Record<string, string>;
  return Number(m.typesense_memory_active_bytes ?? 0);
}

function doc(i: number, withPos: boolean): ProductDoc {
  const d: ProductDoc = {
    id: String(i),
    gid: `gid://shopify/Product/${i}`,
    handle: `p-${i}`,
    title: `Product ${i} classic cotton tee`,
    title_sort: `product ${i}`,
    vendor: `Brand ${i % 40}`,
    product_type: "Shirts",
    tags: ["a", "b", `t${i % 50}`],
    collections: [],
    collection_handles: [],
    collection_titles: [],
    description_text: "Soft cotton tee for everyday wear. ".repeat(10),
    skus: [`SKU-${i}`],
    barcodes: [],
    variant_titles: ["S", "M", "L"],
    option_values: ["S", "M", "L"],
    price_min: 1000 + (i % 9000),
    price_max: 2000,
    discount_pct: 0,
    on_sale: false,
    available: true,
    inventory_total: 5,
    created_at: i,
    published_at: i,
    updated_at: i,
    variants_json: "[]",
  };
  for (let k = 0; k < K; k++) {
    const c = (i * 7 + k * 13) % C;
    d.collections.push(String(1000 + c));
    d.collection_handles.push(`c-${c}`);
    d.collection_titles.push(`Collection ${c}`);
    if (withPos) d[`pos_${1000 + c}`] = (i * 31 + c) % N;
  }
  return d;
}

async function run(withPos: boolean) {
  const name = `benchpos_${withPos ? "pos" : "nopos"}_${Date.now()}`;
  await engine.createCollection(buildProductSchema({ name, locales: [], metafields: [] }));
  const before = await memActive();
  const t0 = performance.now();
  async function* docs() {
    for (let i = 1; i <= N; i++) yield doc(i, withPos);
  }
  await importInBatches(engine, name, docs());
  const importMs = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 1500));
  const after = await memActive();
  // Sort theo một collection thủ công (trang collection), lọc thành viên.
  const times: number[] = [];
  for (let q = 0; q < 30; q++) {
    const c = 1000 + ((q * 17) % C);
    const t = performance.now();
    await engine.search(name, {
      q: "*",
      queryBy: ["title"],
      filterBy: `collections:=\`${c}\``,
      sortBy: withPos
        ? `_eval(available:true):desc,pos_${c}(missing_values: last):asc`
        : "_eval(available:true):desc,best_selling_rank(missing_values: last):asc",
      perPage: 24,
    });
    times.push(performance.now() - t);
  }
  times.sort((x, y) => x - y);
  const sampleBytes = JSON.stringify(doc(1, withPos)).length;
  const fieldCount = (await engine.getCollection(name))?.fields.length ?? 0;
  await engine.dropCollection(name);
  return {
    withPos,
    docBytes: sampleBytes,
    importMs: Math.round(importMs),
    memDeltaMB: Math.round((after - before) / 1024 / 1024),
    p50ms: +times[15].toFixed(1),
    p95ms: +times[28].toFixed(1),
    fields: fieldCount,
  };
}

const base = await run(false);
const pos = await run(true);
console.log(
  JSON.stringify(
    {
      products: N,
      manualCollections: C,
      perProduct: K,
      base,
      pos,
      posOverheadMB: pos.memDeltaMB - base.memDeltaMB,
    },
    null,
    2,
  ),
);
