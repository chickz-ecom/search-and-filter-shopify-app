// Render các trang admin (component view thuần) ra HTML tĩnh + Polaris web components từ CDN Shopify, để Playwright
// kiểm tra bố cục mobile/desktop và Web Vitals cục bộ (task 3.10). Chạy: `npx tsx e2e/admin/render.tsx`.
// Dữ liệu mẫu cố ý dài (nhiều dòng, chuỗi dài, tiếng Việt) để lộ tràn ngang.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { AnalyticsView } from "../../app/components/AnalyticsView";
import { AppearanceView } from "../../app/components/AppearanceView";
import { DevelopersView } from "../../app/components/DevelopersView";
import { FiltersView } from "../../app/components/FiltersView";
import { HomeView } from "../../app/components/HomeView";
import { MerchIndexView, MerchListView } from "../../app/components/MerchViews";
import { PlansView } from "../../app/components/PlansView";
import { SearchView } from "../../app/components/SearchView";
import { SortingView } from "../../app/components/SortingView";
import { SyncView } from "../../app/components/SyncView";
import type { Locale } from "../../app/i18n";
import { themeEditorLinks } from "../../app/lib/admin/theme-links";
import { PLANS } from "../../app/lib/billing/plans";
import { DEFAULT_TOKENS } from "../../app/lib/config/appearance";
import { DEFAULT_FILTERS } from "../../app/lib/config/filters";
import { defaultSearchSettings } from "../../app/lib/config/search-settings";
import { DEFAULT_SORT_OPTIONS } from "../../app/lib/config/sort-options";

const noop = () => undefined;
const asyncEmpty = async () => [];
const shopDomain = "a-very-long-shop-name-for-layout-tests.myshopify.com";
const status = {
  state: "RUNNING" as const,
  productCount: 28_412,
  indexedCount: 12_034,
  percent: 42,
  lastFullSyncAt: "2026-10-25T03:00:00Z",
  lastIncrementalAt: "2026-10-26T09:12:00Z",
  running: null,
  lastError: null,
};
const kpis = {
  searches: 182_340,
  zeroResultRate: 0.043,
  clicks: 51_002,
  ctr: 0.279,
  addToCarts: 8_210,
  revenue: 1_284_220.5,
  previous: { searches: 160_000, zeroResultRate: 0.05, ctr: 0.25, revenue: 1_000_000 },
};
const metafieldDefs = [
  {
    namespace: "custom",
    key: "material_composition_details",
    name: "Material composition details",
    type: "single_line_text_field",
  },
  { namespace: "reviews", key: "rating", name: "Rating", type: "rating" },
];
const queries = Array.from(
  { length: 12 },
  (_, i) => `long search term number ${i + 1} with extra words`,
);

function pages(locale: Locale): Record<string, ReactElement> {
  return {
    home: (
      <HomeView
        locale={locale}
        shopDomain={shopDomain}
        currency="USD"
        status={status}
        kpis={kpis}
        onboarding={{ dismissed: false, search: "2026-10-26" }}
        links={themeEditorLinks(shopDomain, "key123")}
        embed={{ embedEnabled: false, searchBlockAdded: true, collectionBlockAdded: false }}
        onDismiss={noop}
        onPreview={noop}
      />
    ),
    search: (
      <SearchView
        locale={locale}
        initial={defaultSearchSettings()}
        metafieldDefs={metafieldDefs}
        currency="USD"
        saving={false}
        errors={{}}
        preview={{
          total: 3,
          tookMs: 4,
          sort: "relevance",
          hits: [1, 2, 3].map((n) => ({
            id: String(n),
            title: `Organic cotton relaxed-fit crew neck t-shirt, pack of ${n}`,
            price_min: 1900 * n,
            currency: "USD",
            available: n !== 2,
            rank: n,
            score: 1000 - n,
            matched: [{ key: "title", field: "title", tokens: ["cotton", "t-shirt"] }],
            info: { bestFieldWeight: 10, fieldsMatched: 2, tokensMatched: 2, typoPrefixScore: 0 },
          })),
        }}
        previewing={false}
        onSave={noop}
        onPreview={noop}
      />
    ),
    sorting: (
      <SortingView
        locale={locale}
        locales={["en", "vi"]}
        initial={{
          options: DEFAULT_SORT_OPTIONS,
          defaults: { search: "relevance" },
          overrides: [{ collectionId: "77", sortKey: "price_asc" }],
          tieBreak: "best_selling",
        }}
        metafieldDefs={metafieldDefs}
        availability={{ bestSelling: false }}
        collectionTitles={{ "77": "Summer collection with a rather long title" }}
        saving={false}
        errors={{}}
        onSave={noop}
        onPickCollections={asyncEmpty}
      />
    ),
    filters: (
      <FiltersView
        locale={locale}
        locales={["en", "vi"]}
        initial={{
          default: DEFAULT_FILTERS,
          search: null,
          collections: { "77": DEFAULT_FILTERS.slice(0, 2) },
        }}
        metafieldDefs={metafieldDefs}
        collectionTitles={{ "77": "Summer collection with a rather long title" }}
        saving={false}
        errors={{}}
        onSave={noop}
        onPickCollections={asyncEmpty}
      />
    ),
    merchandising: (
      <MerchIndexView
        locale={locale}
        counts={{ synonyms: 12, redirects: 3, rules: 2, stopwords: 40 }}
      />
    ),
    "merchandising-rules": (
      <MerchListView
        locale={locale}
        type="rules"
        lists={{
          synonyms: [],
          redirects: [],
          stopwords: [],
          rules: Array.from({ length: 6 }, (_, i) => ({
            id: `r${i}`,
            name: `Black Friday pin rule for outerwear number ${i}`,
            enabled: i % 2 === 0,
            condition: { query: "winter jacket waterproof", match: "contains" },
            actions: { pin: [{ productId: "5", position: 1 }], hide: [], boost: [] },
            startsAt: "2026-11-20T00:00:00Z",
            endsAt: "2026-12-01T00:00:00Z",
          })),
        }}
        names={{ "5": "Red tee" }}
        busy={false}
        errors={{}}
        saved={null}
        onMutate={noop}
        onPickProducts={asyncEmpty}
        onPickCollection={async () => null}
      />
    ),
    appearance: (
      <AppearanceView
        locale={locale}
        locales={["en", "vi"]}
        currency="USD"
        css={readFileSync("extensions/search-theme/assets/searchapp.css", "utf8")}
        initial={{ tokens: DEFAULT_TOKENS, texts: {}, templates: {} }}
        saving={false}
        errors={{}}
        onSave={noop}
      />
    ),
    analytics: (
      <AnalyticsView
        locale={locale}
        currency="USD"
        loading={false}
        onRangeChange={noop}
        suggestions={[
          { query: "tshirt", searches: 42, term: "T-Shirt", reason: "spacing", products: 128 },
          {
            query: "waterproof trainers for winter",
            searches: 9,
            term: "Running shoes",
            reason: "meaning",
            products: 31,
          },
        ]}
        onSuggestion={noop}
        report={{
          range: 30,
          kpis,
          topQueries: queries.map((query, i) => ({
            query,
            searches: 9000 - i * 100,
            clicks: 3000,
            ctr: 0.33,
            addToCarts: 120,
            revenue: 12_345.67,
          })),
          zeroResults: queries
            .slice(0, 6)
            .map((query) => ({ query, searches: 40, zeroResults: 40 })),
          filterUsage: [
            {
              key: "filter.p.vendor",
              label: "Brand",
              value: "A brand with a long name",
              count: 900,
              share: 0.6,
            },
            { key: "filter.v.option.size", label: "Size", value: "XL", count: 600, share: 0.4 },
          ],
          sortUsage: [
            { key: "price_asc", label: "Price, low to high", value: "", count: 300, share: 1 },
          ],
        }}
      />
    ),
    sync: (
      <SyncView
        locale={locale}
        status={status}
        jobs={Array.from({ length: 8 }, (_, i) => ({
          id: `j${i}`,
          type: i % 2 ? ("INCREMENTAL" as const) : ("FULL" as const),
          status: i === 0 ? ("RUNNING" as const) : ("SUCCEEDED" as const),
          startedAt: "2026-10-26T09:00:00Z",
          durationMs: 61_000,
          imported: 28_412,
          error: null,
        }))}
        hint={null}
        submitting={false}
        onSyncNow={noop}
      />
    ),
    developers: (
      <DevelopersView
        locale={locale}
        info={{
          shopDomain,
          publicKey: "pk_9f3b2a7c1d4e5f60718293a4b5c6d7e8",
          endpoint: "https://search.example-app-domain.com",
          docsUrl: "https://docs.example-app-domain.com",
          headless: {
            entitled: true,
            minPlan: "Pro",
            enabled: true,
            origins: ["https://www.example.com"],
          },
        }}
        saving={false}
        errors={{}}
        onSave={noop}
        onCopy={noop}
      />
    ),
    plans: (
      <PlansView
        locale={locale}
        plans={PLANS}
        subscription={{
          planId: "growth",
          source: "partner",
          billingPeriod: "MONTHLY",
          renewsAt: "2026-11-01T00:00:00Z",
          trialEndsAt: null,
          cancelAtEndOfCycle: false,
          pendingPlanId: null,
        }}
        productCount={28_412}
        recommended="pro"
        selectionUrl="https://admin.shopify.com/store/acme/charges/search-filter/pricing_plans"
        checkFailed={false}
      />
    ),
  };
}

const out = "e2e/fixtures/admin";
mkdirSync(out, { recursive: true });
const names: string[] = [];
for (const locale of ["en", "vi"] as const) {
  for (const [name, el] of Object.entries(pages(locale))) {
    const file = `${name}.${locale}.html`;
    names.push(file);
    writeFileSync(
      `${out}/${file}`,
      `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>` +
        `<title>${name}</title></head><body>${renderToStaticMarkup(el)}</body></html>`,
    );
  }
}
writeFileSync(`${out}/index.json`, JSON.stringify(names));
console.log(`[admin-fixtures] ${names.length} pages → ${out}`);
