// Load test search-api (DoD 2.1: 200 RPS, p95 < 120 ms; task 6.2: Black Friday ×10).
//   npx tsx scripts/load-test-search.ts --products 30000 --rps 200 --duration 20 [--queries 300] [--connections 50]
//   Black Friday ×10: --rps 2000 --workers 8 --queries 3000 --zipf  (search-api nhiều process, truy vấn phân bố Zipf
//   như thật: vài truy vấn rất phổ biến + đuôi dài; KHÔNG tính CDN — đây là tải tới origin).
// Seed shop tạm (DB dev + Typesense), chạy server (cluster nếu --workers > 1), bắn tải, in p50/p95/p99 rồi dọn sạch.
import cluster from "node:cluster";
import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import autocannon from "autocannon";
import { parseArgs } from "node:util";
import { createSearchApi } from "../services/search-api/src/app";
import { buildContentSchema, buildProductSchema } from "../app/lib/search/index-schema";
import {
  contentAlias,
  contentCollection,
  productAlias,
  productCollection,
} from "../app/lib/search/names";
import type { ProductDoc } from "../app/lib/search/product-doc";
import { TypesenseEngine } from "../app/lib/search/typesense-engine";
import { ensureShop } from "../app/lib/shop/shop.server";
import { importInBatches } from "../app/lib/sync/pipeline";

const { values: a } = parseArgs({
  options: {
    products: { type: "string", default: "30000" },
    rps: { type: "string", default: "200" },
    duration: { type: "string", default: "20" },
    queries: { type: "string", default: "300" },
    connections: { type: "string", default: "50" },
    port: { type: "string", default: "8799" },
    keep: { type: "boolean", default: false },
    workers: { type: "string", default: "1" },
    zipf: { type: "boolean", default: false },
    // Đối chứng: chỉ /v1/config (cache trong process, không chạm Typesense) → đo overhead máy tải/Node.
    "config-only": { type: "boolean", default: false },
  },
});

const N = Number(a.products);
const WORDS =
  "classic slim relaxed cotton linen wool denim summer winter vintage premium soft organic shirt pants dress jacket shoes hat bag".split(
    " ",
  );
const VENDORS = Array.from({ length: 40 }, (_, i) => `Brand ${i}`);
const engine = new TypesenseEngine({
  host: process.env.TYPESENSE_HOST ?? "localhost",
  port: Number(process.env.TYPESENSE_PORT ?? 8108),
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
  connectionTimeoutSeconds: 10,
});
// Giống server.ts của search-api: pool nhỏ mỗi process.
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
if (!dbUrl.searchParams.has("connection_limit")) dbUrl.searchParams.set("connection_limit", "5");
const db = new PrismaClient({ datasourceUrl: dbUrl.toString() });

function doc(i: number): ProductDoc {
  const w = (k: number) => WORDS[(i * 7 + k * 3) % WORDS.length];
  return {
    id: String(i),
    gid: `gid://shopify/Product/${i}`,
    handle: `p-${i}`,
    title: `${w(1)} ${w(2)} ${w(3)} ${i}`,
    title_sort: `${w(1)} ${i}`,
    vendor: VENDORS[i % 40],
    product_type: ["Shirts", "Pants", "Shoes", "Hats"][i % 4],
    tags: [w(4), w(5), `tag-${i % 50}`],
    collections: [String(1 + (i % 20))],
    collection_handles: [`c-${1 + (i % 20)}`],
    collection_titles: [`C ${1 + (i % 20)}`],
    description_text: `${w(6)} ${w(7)} ${w(8)} product ${i}. `.repeat(6),
    skus: [`SKU-${i}`],
    barcodes: [],
    variant_titles: ["S", "M", "L"],
    option_values: ["S", "M", "L"],
    opt_size: ["S", "M", "L"].slice(0, 1 + (i % 3)),
    price_min: 1000 + ((i * 37) % 9000),
    price_max: 12000,
    discount_pct: i % 5 === 0 ? 20 : 0,
    on_sale: i % 5 === 0,
    available: i % 9 !== 0,
    inventory_total: i % 20,
    created_at: i,
    published_at: i,
    updated_at: i,
    best_selling_rank: i,
    variants_json: "[]",
    pos_1: i,
  };
}

async function main() {
  const domain = `load-${Date.now()}.myshopify.com`;
  const { shop } = await ensureShop(db, domain, {
    currency: "USD",
    primaryLocale: "en",
    locales: ["en"],
  });
  await engine.upsertSynonymSet(`syn_${shop.id}`, []);
  await engine.upsertCurationSet(`cur_${shop.id}`, []);
  const pname = productCollection(shop.id, 1);
  await engine.createCollection(
    buildProductSchema({
      name: pname,
      locales: [],
      metafields: [],
      synonymSets: [`syn_${shop.id}`],
      curationSets: [`cur_${shop.id}`],
    }),
  );
  await engine.upsertAlias(productAlias(shop.id), pname);
  await engine.createCollection(buildContentSchema(contentCollection(shop.id, 1)));
  await engine.upsertAlias(contentAlias(shop.id), contentCollection(shop.id, 1));
  await engine.importDocuments(
    contentCollection(shop.id, 1),
    Array.from({ length: 20 }, (_, i) => ({
      id: `collection-${i + 1}`,
      type: "collection",
      title: `${WORDS[i]} collection`,
      handle: `c-${i + 1}`,
      url: `/collections/c-${i + 1}`,
      body_text: "",
      updated_at: 1,
      sort_order: i === 0 ? "MANUAL" : "BEST_SELLING",
    })) as never,
  );
  console.log(`seeding ${N} products…`);
  async function* docs() {
    for (let i = 1; i <= N; i++) yield doc(i);
  }
  await importInBatches(engine, pname, docs());

  // Rate limit theo shop: gói free 600 rpm → nâng tạm cho load test (×10 vượt cả rpm enterprise → feature riêng).
  await db.shop.update({ where: { id: shop.id }, data: { plan: "enterprise" } });
  const W = Number(a.workers);
  let server: { close(): void };
  if (W > 1) {
    // Node cluster: các process chia nhau cổng (round-robin) — giống chạy N replica sau load balancer.
    let ready = 0;
    const workers = Array.from({ length: W }, () => cluster.fork({ LOAD_PORT: a.port }));
    await new Promise<void>((res) =>
      workers.forEach((w) => w.on("message", (m) => m === "ready" && ++ready === W && res())),
    );
    server = { close: () => workers.forEach((w) => w.kill()) };
  } else server = serve({ fetch: serverApp().fetch, port: Number(a.port) });
  const base = `http://127.0.0.1:${a.port}`;
  const common = `shop=${domain}&key=${shop.publicKey}`;
  const Q = Number(a.queries);
  const paths: string[] = [];
  for (let i = 0; i < Q; i++) {
    const q = `${WORDS[i % WORDS.length]} ${WORDS[(i * 5) % WORDS.length]}`.slice(0, 3 + (i % 12));
    switch (i % 5) {
      case 0:
        paths.push(`/v1/suggest?${common}&q=${encodeURIComponent(q)}`);
        break;
      case 1:
        paths.push(
          `/v1/search?${common}&q=${encodeURIComponent(q)}&filter.p.vendor=Brand+${i % 40}`,
        );
        break;
      case 2:
        paths.push(
          `/v1/collection?${common}&collection=c-${1 + (i % 20)}&sort=${["manual", "price_asc", "best_selling"][i % 3]}&page=${1 + (i % 3)}`,
        );
        break;
      case 3:
        paths.push(
          `/v1/search?${common}&q=${encodeURIComponent(q)}&filter.v.price.gte=${10 + (i % 20)}&filter.v.price.lte=80&sort=price_desc`,
        );
        break;
      default:
        paths.push(`/v1/search?${common}&q=${encodeURIComponent(q)}`);
    }
  }
  // Làm ấm (JIT, kết nối) — không tính.
  for (const p of paths.slice(0, 20))
    await fetch(base + p, { headers: { Origin: `https://${domain}` } });

  if (a["config-only"]) paths.splice(0, paths.length, `/v1/config?${common}`);
  // Zipf (s = 1): truy vấn hạng k được hỏi tỉ lệ 1/k — sát hành vi thật (top 1% truy vấn chiếm phần lớn lượt).
  const cdf: number[] = [];
  let acc = 0;
  for (let k = 1; k <= paths.length; k++) cdf.push((acc += a.zipf ? 1 / k : 1));
  const pick = () => {
    const r = Math.random() * acc;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return paths[lo];
  };
  const result = await autocannon({
    url: base,
    connections: Number(a.connections),
    overallRate: Number(a.rps),
    duration: Number(a.duration),
    headers: { Origin: `https://${domain}` },
    requests: [
      {
        setupRequest: (req) => ({ ...req, path: pick() }),
      },
    ],
  });
  server.close();

  const non2xx = result.non2xx;
  console.log(
    JSON.stringify(
      {
        products: N,
        targetRps: Number(a.rps),
        achievedRps: Math.round(result.requests.average),
        requests: result.requests.total,
        non2xx,
        errors: result.errors,
        latencyMs: {
          p50: result.latency.p50,
          p90: result.latency.p90,
          p97_5: result.latency.p97_5,
          p99: result.latency.p99,
          max: result.latency.max,
        },
        distinctPaths: paths.length,
        workers: W,
        zipf: Boolean(a.zipf),
      },
      null,
      2,
    ),
  );
  if (!a.keep) {
    await engine.deleteAlias(productAlias(shop.id));
    await engine.deleteAlias(contentAlias(shop.id));
    await engine.dropCollection(pname);
    await engine.dropCollection(contentCollection(shop.id, 1));
    await engine.deleteSynonymSet(`syn_${shop.id}`);
    await engine.deleteCurationSet(`cur_${shop.id}`);
    await db.shop.delete({ where: { id: shop.id } });
  }
  await db.$disconnect();
}

function serverApp() {
  return createSearchApi({
    db,
    engineFor: () => engine,
    defaultEngine: engine,
    ipRpm: 1_000_000,
    shopRpmMultiplier: 10, // cấu hình Black Friday (docs/ops/load-and-ha.md)
  });
}

if (cluster.isWorker) {
  // Shop trong load test dùng gói enterprise; rate limit theo shop của gói vẫn áp dụng như thật.
  serve({ fetch: serverApp().fetch, port: Number(process.env.LOAD_PORT) }, () =>
    process.send?.("ready"),
  );
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
