import { render } from "../../../packages/storefront-sdk/src/template";
import { formatMoney } from "../../../packages/storefront-sdk/src/money";
import { DEFAULT_TEMPLATES } from "../../../packages/storefront-ui/src/templates";
import { tokensToCssVars, type AppearanceConfig } from "../config/appearance";
import { DEFAULT_TEXTS } from "../config/default-texts";

// Live preview cho Appearance (BFS 4.2.6): dùng CHÍNH CSS + template engine + template mặc định của widget storefront,
// nên preview khớp những gì khách thấy. Render trong iframe srcdoc (cách ly CSS với admin).

const SAMPLE = [
  {
    id: "1",
    title: "Classic cotton tee",
    vendor: "Acme",
    price: 1900,
    compare: 2500,
    available: true,
  },
  { id: "2", title: "Relaxed linen shirt", vendor: "Northwind", price: 4800, available: true },
  { id: "3", title: "Slim denim jeans", vendor: "Acme", price: 5900, available: false },
  { id: "4", title: "Wool beanie", vendor: "Fjord", price: 2200, available: true },
];

// "#" cuối: filter img_url nối "?width=" vào URL — phần đó rơi vào fragment, không làm hỏng SVG.
const swatch = (seed: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="hsl(${seed * 67},35%,82%)"/></svg>`)}#`;

export function buildPreviewHtml(
  cfg: AppearanceConfig,
  css: string,
  locale: string,
  currency = "USD",
): string {
  const base = locale.startsWith("vi") ? "vi" : "en";
  const texts = {
    ...DEFAULT_TEXTS[base],
    ...((cfg.texts[locale] ?? cfg.texts[base] ?? {}) as Record<string, string>),
  };
  const tpl = cfg.templates["product-card"] || DEFAULT_TEMPLATES["product-card"];
  const money = (v: number) =>
    formatMoney(v, currency, currency === "USD" ? "${{amount}}" : "{{amount}} " + currency);
  const vars = Object.entries(tokensToCssVars(cfg.tokens))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  const cards = SAMPLE.map((p, i) =>
    render(
      tpl,
      {
        ...p,
        url: "#",
        position: i + 1,
        image: swatch(i + 1),
        image_alt: p.title,
        vendor: cfg.tokens.showVendor ? p.vendor : "",
        priceReady: true,
        price: money(p.price),
        compare_at_price: p.compare ? money(p.compare) : null,
        badge_labels: [...(p.compare ? [texts.sale] : []), ...(p.available ? [] : [texts.soldOut])],
        view_price: texts.viewPrice,
      },
      { money },
    ),
  ).join("");
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const fill = (s: string, v: Record<string, string | number>) =>
    s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}
:root{${vars}}body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--sa-text);background:var(--sa-bg)}
.pv-input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--sa-border);border-radius:var(--sa-radius);font:inherit}
.pv-ac{position:static;margin:4px 0 24px}</style></head><body>
<input class="pv-input" value="tee" aria-label="${esc(texts.placeholder)}" placeholder="${esc(texts.placeholder)}" readonly>
<div class="sa-ac pv-ac" role="listbox" aria-label="Preview"><div class="sa-ac__group" role="group" aria-label="${esc(texts.products)}"><p class="sa-ac__heading" aria-hidden="true">${esc(texts.products)}</p>
${SAMPLE.slice(0, 2)
  .map(
    (p, i) =>
      `<a role="option" id="pv-${i}" class="sa-ac__item" href="#" aria-selected="${i === 0}"><img src="${swatch(i + 1)}" alt="" width="48" height="48"><span class="sa-ac__text"><span class="sa-ac__title">${esc(p.title)}</span><span class="sa-ac__price">${esc(money(p.price))}</span></span></a>`,
  )
  .join("")}
</div></div>
<div class="sa-layout sa-layout--left"><div class="sa-toolbar"><p class="sa-total">${esc(fill(texts.results, { n: 132 }))}</p><label class="sa-sort">${esc(texts.sortBy)} <select><option>Relevance</option></select></label></div>
<aside class="sa-filters" aria-label="${esc(texts.filters)}"><div class="sa-filters__panel"><div class="sa-filters__body"><details class="sa-facet" open><summary class="sa-facet__title">Brand<span class="sa-badge-count">1</span></summary><div class="sa-facet__body"><ul><li><label class="sa-opt"><input type="checkbox" checked><span>Acme</span> <span class="sa-count">(12)</span></label></li><li><label class="sa-opt"><input type="checkbox"><span>Fjord</span> <span class="sa-count">(4)</span></label></li></ul></div></details></div></div></aside>
<div class="sa-main"><div class="sa-chips"><button type="button" class="sa-chip">Acme ×</button><button type="button" class="sa-chip">${esc(texts.clearAll)}</button></div>
<ul class="sa-grid" style="--sa-cols:${cfg.tokens.columns}">${cards}</ul></div></div></body></html>`;
}
