// Lighthouse so sánh có / không có app (task 2.14, BFS: giảm ≤ 10 điểm; mục tiêu nội bộ ≤ 5).
//   node scripts/lighthouse-compare.mjs [--runs 3] [--budget 5]
// Dựng theme fixture tối giản (Home / Product / Collection) phục vụ bằng server nội bộ + search API giả,
// chạy Lighthouse mobile (throttling mặc định) cho từng trang với app tắt/bật, lấy median, tính trung bình có trọng số
// Home 17% · Product 40% · Collection 43% như BFS. Đo thật trên Horizon: lighthouserc.json + HUMAN_TODO G3.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { gzipSync } from "node:zlib";

const { values: a } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    budget: { type: "string", default: "5" },
    port: { type: "string", default: "4180" },
    serve: { type: "boolean", default: false },
    // Mô phỏng theme thật (Horizon có điểm gốc ~60–85): JS/CSS của theme nạp ở CẢ hai bản để điểm không bão hoà.
    "theme-js-kb": { type: "string", default: "180" },
    "theme-css-kb": { type: "string", default: "60" },
  },
});
const root = fileURLToPath(new URL("..", import.meta.url));
const assets = join(root, "extensions/search-theme/assets");
const PORT = Number(a.port);

const products = Array.from({ length: 24 }, (_, i) => ({
  id: String(i + 1),
  gid: `gid://shopify/Product/${i + 1}`,
  handle: `p-${i + 1}`,
  url: `/products/p-${i + 1}`,
  title: `Product ${i + 1}`,
  vendor: "Acme",
  product_type: "",
  available: true,
  price_min: 1000 + i * 100,
  price_max: 1000 + i * 100,
  discount_pct: 0,
  on_sale: false,
  currency: "USD",
  tags: [],
  variants: [],
  badges: [],
}));
const img = (i) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#${((i * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(0, 6)}"/></svg>`)}`;

function page(type, app) {
  const grid = (type === "collection" ? products : products.slice(0, 8))
    .map(
      (p, i) =>
        `<li class="sa-card" data-sa-id="${p.id}"><a class="sa-card__link" href="${p.url}"><div class="sa-card__media"><img src="${img(i)}" alt="${p.title}" width="400" height="400" loading="${i < 4 ? "eager" : "lazy"}"></div><div class="sa-card__info"><h3 class="sa-card__title">${p.title}</h3><p class="sa-card__price">$${(p.price_min / 100).toFixed(2)}</p></div></a></li>`,
    )
    .join("");
  const body =
    type === "product"
      ? `<main><div class="pdp"><img src="${img(99)}" alt="Product" width="600" height="600"><div><h1>Product 1</h1><p class="price">$10.00</p><button>Add to cart</button><p>${"Lorem ipsum dolor sit amet. ".repeat(20)}</p></div></div></main>`
      : type === "collection"
        ? `<main><h1>Summer</h1>${app ? '<div class="sa-block" data-searchapp-mount="search-page" data-mode="collection" data-collection="summer" data-per-page="24" data-columns="4">' : "<div>"}<div class="sa-layout sa-layout--left"><div class="sa-toolbar"><p class="sa-total">24 results</p></div><aside class="sa-filters" aria-hidden="true"></aside><div class="sa-main"><ul class="sa-grid" style="--sa-cols:4" data-native-results>${grid}</ul></div></div></div></main>`
        : `<main><h1>Welcome</h1><p>${"Featured products. ".repeat(10)}</p><ul class="sa-grid" style="--sa-cols:4">${grid}</ul></main>`;
  const config = `<script id="searchapp-config" type="application/json">${JSON.stringify({ shop: "lh.myshopify.com", publicKey: "", apiBase: "/apps/search", proxy: true, country: "US", language: "en", currency: "USD", shopCurrency: "USD", moneyFormat: "${{amount}}", locale: "en", pageType: type, searchUrl: "/search", collection: type === "collection" ? { id: "77", handle: "summer" } : null })}</script>`;
  // Giống blocks/app-embed.liquid: SDK chỉ tải sẵn ở trang search/collection; trang khác nạp lười khi focus ô search.
  const eager = type === "collection";
  const loader = `<script>(function(){var sdk='/assets/searchapp-sdk.js';function l(s){if(document.querySelector('script[src="'+s+'"]'))return;var e=document.createElement('script');e.src=s;e.async=true;document.head.appendChild(e)}window.SearchApp=window.SearchApp||{ready:function(){return new Promise(function(r){document.addEventListener('searchapp:ready',function(e){r(e.detail)},{once:true});l(sdk)})}};document.addEventListener('focusin',function f(e){if(e.target.matches&&e.target.matches('form[action*="/search"] input[name="q"]')){document.removeEventListener('focusin',f,true);l(sdk);l('/assets/searchapp-instant.js')}},true);document.addEventListener('DOMContentLoaded',function(){if(document.querySelector('[data-searchapp-mount]')){l(sdk);l('/assets/searchapp-results.js')}})})();</script>`;
  const appTags = app
    ? `${config}${eager ? '<script src="/assets/searchapp-sdk.js" defer></script>' : ""}${loader}`
    : "";
  // Block (chỉ trang collection/search) khai "stylesheet" → CSS chặn render chỉ ở đó; theme thật đã có CSS grid tương đương.
  const css =
    app && type === "collection" ? '<link rel="stylesheet" href="/assets/searchapp.css">' : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${type}</title><meta name="description" content="fixture">
<style>body{font-family:system-ui,sans-serif;margin:0}header{padding:12px 16px;border-bottom:1px solid #ddd}main{padding:16px;max-width:1100px;margin:auto}.sa-grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,1fr);gap:12px}@media(min-width:750px){.sa-grid{grid-template-columns:repeat(4,1fr)}}.sa-card__media img{width:100%;height:auto;display:block}.pdp{display:grid;gap:16px}.pdp img{width:100%;height:auto}a{color:inherit}</style>
<link rel="stylesheet" href="/theme.css">${css}</head>
<body><script src="/theme.js" defer></script><header>
<form action="/search" role="search"><label for="q">Search</label> <input id="q" name="q" type="search"> <button>Go</button></form></header>${body}${appTags}</body></html>`;
}

// Theme giả: JS có việc tính toán thật (main thread) + CSS, kích thước cấu hình được.
// Payload ngẫu nhiên (không nén được như code thật bị minify) + vòng tính ~ tỷ lệ với kích thước (TBT như theme thật).
const noise = Array.from({ length: Number(a["theme-js-kb"]) * 1024 }, (_, i) =>
  String.fromCharCode(97 + ((i * 7919 + (i >> 3) * 104729) % 26)),
).join("");
const themeJs = `(function(){var s=0;for(var i=0;i<${Number(a["theme-js-kb"]) * 25000};i++){s+=Math.sqrt(i)*Math.sin(i)}window.__theme=s;})();\nvar __pad=${JSON.stringify(noise)};`;
const themeCss = Array.from(
  { length: Number(a["theme-css-kb"]) * 12 },
  (_, i) =>
    `.t${i}{color:#${(i * 99991).toString(16).slice(0, 6).padEnd(6, "0")};margin:${i % 7}px}`,
).join("\n");
const send = (req, res, type, body) => {
  const gz = /gzip/.test(req.headers["accept-encoding"] ?? "");
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "public, max-age=31536000",
    ...(gz ? { "content-encoding": "gzip" } : {}),
  });
  res.end(gz ? gzipSync(body) : body);
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/theme.js") return send(req, res, "text/javascript", themeJs);
  if (url.pathname === "/theme.css") return send(req, res, "text/css", themeCss);

  if (url.pathname.startsWith("/assets/")) {
    try {
      const body = await readFile(join(assets, url.pathname.slice(8)));
      return send(req, res, url.pathname.endsWith(".css") ? "text/css" : "text/javascript", body);
    } catch {
      return res.writeHead(404).end();
    }
  }
  if (url.pathname.startsWith("/apps/search/v1/")) {
    const path = url.pathname.slice(16);
    res.writeHead(200, { "content-type": "application/json" });
    if (path === "config") {
      return res.end(
        JSON.stringify({
          version: "1",
          locale: "en",
          shop: { currency: "USD", primaryLocale: "en", locales: ["en"] },
          searchTypes: {},
          sortOptions: [{ key: "manual", label: "Featured" }],
          sortDefaults: { search: "relevance" },
          filters: { default: [], search: [] },
          texts: { results: "{n} results", sortBy: "Sort by" },
          appearance: {},
          templates: {},
          fixedPriceCountries: [],
          adjustedCountries: [],
        }),
      );
    }
    return res.end(
      JSON.stringify({
        query: "",
        redirect: null,
        total: 24,
        page: 1,
        per_page: 24,
        sort: "manual",
        sort_options: [{ key: "manual", label: "Featured" }],
        products: products.map((p, i) => ({ ...p, image: img(i) })),
        facets: [],
        applied_filters: {},
        currency: "USD",
      }),
    );
  }
  const m = /^\/(home|product|collection)$/.exec(url.pathname);
  if (!m) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page(m[1], url.searchParams.get("app") === "1"));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
if (a.serve) {
  console.log(`fixture server on http://127.0.0.1:${PORT}/{home,product,collection}?app=0|1`);
  await new Promise(() => undefined);
}

const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const METRICS = {
  lcp: "largest-contentful-paint",
  tbt: "total-blocking-time",
  cls: "cumulative-layout-shift",
  si: "speed-index",
};
async function score(path) {
  const runs = [];
  for (let i = 0; i < Number(a.runs); i++) {
    const r = await lighthouse(`http://127.0.0.1:${PORT}${path}`, {
      port: chrome.port,
      onlyCategories: ["performance"],
      output: "json",
      logLevel: "error",
    });
    const au = r.lhr.audits;
    const js = (au["network-requests"]?.details?.items ?? [])
      .filter((x) => x.resourceType === "Script")
      .reduce((s, x) => s + (x.transferSize ?? 0), 0);
    runs.push({
      score: Math.round((r.lhr.categories.performance.score ?? 0) * 100),
      ...Object.fromEntries(
        Object.entries(METRICS).map(([k, id]) => [k, au[id]?.numericValue ?? 0]),
      ),
      jsKB: Math.round(js / 102.4) / 10,
    });
  }
  const pick = (k) => median(runs.map((r) => r[k]));
  return {
    score: pick("score"),
    lcpMs: Math.round(pick("lcp")),
    tbtMs: Math.round(pick("tbt")),
    cls: Math.round(pick("cls") * 1000) / 1000,
    siMs: Math.round(pick("si")),
    jsKB: pick("jsKB"),
  };
}

const weights = { home: 0.17, product: 0.4, collection: 0.43 };
const report = {};
let weighted = 0;
for (const [type, w] of Object.entries(weights)) {
  const base = await score(`/${type}?app=0`);
  const withApp = await score(`/${type}?app=1`);
  report[type] = { base, withApp, drop: base.score - withApp.score };
  weighted += (base.score - withApp.score) * w;
}
await chrome.kill();
server.close();
const result = {
  runs: Number(a.runs),
  pages: report,
  weightedDrop: Math.round(weighted * 10) / 10,
  budget: Number(a.budget),
};
console.log(JSON.stringify(result, null, 2));
if (weighted > Number(a.budget)) process.exit(1);
