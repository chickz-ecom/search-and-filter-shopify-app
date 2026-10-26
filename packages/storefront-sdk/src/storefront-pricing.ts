import { currencyExponent } from "./money";
import type { ApiProduct, Localized, Pricer } from "./pricing";
import type { SearchAppContext } from "./types";

// Giá theo market (D15, task 2.7b): MỘT request Storefront API `nodes(ids:)` + `@inContext(country, language)` cho cả
// trang (≤ 48 ID; autocomplete ≤ 6). Không lấy variants (giữ complexity thấp). Node null → không bán ở market → ẩn.
// Lỗi/timeout > 1.5s → ok=false → UI ẩn số tiền ("Xem giá"), không bao giờ hiện sai currency.
// Query đã validate 2026-10: docs/shopify-api/storefront/product-prices.graphql.

export const PRICES_QUERY =
  "query ProductPrices($ids:[ID!]!,$country:CountryCode,$language:LanguageCode)@inContext(country:$country,language:$language){nodes(ids:$ids){...on Product{id availableForSale priceRange{minVariantPrice{amount currencyCode}maxVariantPrice{amount currencyCode}}compareAtPriceRange{maxVariantPrice{amount currencyCode}}}}}";

type MoneyV2 = { amount: string; currencyCode: string } | null;
type PriceNode = {
  id: string;
  availableForSale: boolean;
  priceRange: { minVariantPrice: MoneyV2; maxVariantPrice: MoneyV2 };
  compareAtPriceRange: { maxVariantPrice: MoneyV2 } | null;
} | null;

type Entry = {
  min: number;
  max: number;
  compareAtMax?: number;
  available: boolean;
  currency: string;
} | null;

/** "pt-BR" → "PT_BR" (enum LanguageCode). */
export const languageCode = (l: string) => l.replace("-", "_").toUpperCase();

const toMinor = (m: MoneyV2) =>
  m ? Math.round(Number(m.amount) * 10 ** currencyExponent(m.currencyCode)) : 0;

export function median(xs: number[]): number {
  if (!xs.length) return 1;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type PricerDeps = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  onError?: (e: unknown) => void;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
};

export function createPricer(ctx: SearchAppContext, deps: PricerDeps = {}): Pricer {
  const version = ctx.storefront?.version ?? "2026-10";
  // Endpoint có tài liệu: https://{shop}.myshopify.com/api/{v}/graphql.json. Same-origin cấu hình qua context (task 2.7a).
  const endpoint = ctx.storefront?.endpoint ?? `https://${ctx.shop}/api/${version}/graphql.json`;
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const timeout = deps.timeoutMs ?? 1500;
  const storage =
    deps.storage !== undefined
      ? deps.storage
      : typeof sessionStorage !== "undefined"
        ? sessionStorage
        : null;
  const rateKey = `sa_rate_${ctx.country}_${ctx.currency}`;
  const cache = new Map<string, Entry>();
  let lastRate = Number(storage?.getItem(rateKey)) || 1;

  async function fetchPrices(gids: string[]): Promise<boolean> {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timer = setTimeout(() => ctrl?.abort(), timeout);
    try {
      const r = await doFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: PRICES_QUERY,
          variables: {
            ids: gids,
            country: ctx.country || null,
            language: ctx.language ? languageCode(ctx.language) : null,
          },
        }),
        signal: ctrl?.signal,
        credentials: "omit",
      });
      if (!r.ok) throw new Error(`Storefront HTTP ${r.status}`);
      const body = (await r.json()) as { data?: { nodes: PriceNode[] }; errors?: unknown };
      if (!body.data || body.errors) throw new Error("Storefront GraphQL error");
      // nodes có thể chứa null → map theo id, ID không có trong kết quả = không bán ở market này.
      const found = new Set<string>();
      for (const n of body.data.nodes) {
        if (!n) continue;
        found.add(n.id);
        const cur = n.priceRange.minVariantPrice?.currencyCode ?? ctx.currency;
        const cmp = toMinor(n.compareAtPriceRange?.maxVariantPrice ?? null);
        cache.set(`${ctx.country}|${n.id}`, {
          min: toMinor(n.priceRange.minVariantPrice),
          max: toMinor(n.priceRange.maxVariantPrice),
          ...(cmp ? { compareAtMax: cmp } : {}),
          available: n.availableForSale,
          currency: cur,
        });
      }
      for (const g of gids) if (!found.has(g)) cache.set(`${ctx.country}|${g}`, null);
      return true;
    } catch (e) {
      deps.onError?.(e);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    needsLocalPrice: (adjusted = false) => ctx.currency !== ctx.shopCurrency || adjusted,
    rate: () => lastRate,
    async localize(products: ApiProduct[]): Promise<Localized> {
      const gids = products.map((p) => p.gid).filter(Boolean);
      const missing = [...new Set(gids.filter((g) => !cache.has(`${ctx.country}|${g}`)))];
      let ok = true;
      for (let i = 0; i < missing.length && ok; i += 160)
        ok = await fetchPrices(missing.slice(i, i + 160));
      const prices: Localized["prices"] = new Map();
      const ratios: number[] = [];
      let currency = ctx.currency;
      for (const p of products) {
        const e = cache.get(`${ctx.country}|${p.gid}`);
        if (e === undefined) continue;
        if (e === null) {
          prices.set(p.gid, null);
          continue;
        }
        currency = e.currency;
        prices.set(p.gid, {
          min: e.min,
          max: e.max,
          compareAtMax: e.compareAtMax,
          available: e.available,
        });
        if (p.price_min > 0 && e.min > 0) {
          ratios.push(
            e.min /
              10 ** currencyExponent(e.currency) /
              (p.price_min / 10 ** currencyExponent(p.currency)),
          );
        }
      }
      if (ratios.length) {
        lastRate = median(ratios);
        storage?.setItem(rateKey, String(lastRate));
      }
      return { prices, currency, rate: lastRate, ok };
    },
  };
}
