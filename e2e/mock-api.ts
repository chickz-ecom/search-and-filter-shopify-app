import type { Page, Route } from "@playwright/test";

// Backend giả cho E2E: /apps/search/v1/* (app proxy) + Storefront API graphql.json.
type P = {
  id: string;
  title: string;
  vendor: string;
  price: number;
  available: boolean;
  image?: string;
};
const PRODUCTS: P[] = [
  { id: "1", title: "Red tee", vendor: "Nike", price: 1900, available: true },
  { id: "2", title: "Blue jeans", vendor: "Levis", price: 5000, available: true },
  { id: "3", title: "Green shorts", vendor: "Nike", price: 2500, available: false },
  { id: "4", title: "Shirt classic", vendor: "Adidas", price: 3000, available: true },
  { id: "5", title: "Shoes runner", vendor: "Nike", price: 9000, available: true },
];

const config = {
  version: "1",
  locale: "en",
  shop: { currency: "USD", primaryLocale: "en", locales: ["en"] },
  searchTypes: {
    products: { autocomplete: true, results: true },
    collections: { autocomplete: true, results: false },
    pages: { autocomplete: false, results: false },
    articles: { autocomplete: false, results: false },
  },
  sortOptions: [
    { key: "relevance", label: "Relevance" },
    { key: "price_asc", label: "Price, low to high" },
    { key: "price_desc", label: "Price, high to low" },
  ],
  sortDefaults: { search: "relevance" },
  filters: {
    default: [] as unknown[],

    search: [
      {
        id: "availability",
        label: "Availability",
        type: "toggle",
        source: "availability",
        param: "filter.v.availability",
        collapsed: false,
        showCount: true,
      },
      {
        id: "price",
        label: "Price",
        type: "range",
        source: "price",
        param: "filter.v.price",
        collapsed: false,
        showCount: false,
      },
      {
        id: "vendor",
        label: "Brand",
        type: "checkbox",
        source: "vendor",
        param: "filter.p.vendor",
        collapsed: false,
        showCount: true,
      },
    ],
  },
  texts: {
    placeholder: "Search products",
    noResults: "No results for “{q}”",
    noResultsHint: "Try again.",
    viewAll: "View all {n} results",
    products: "Products",
    collections: "Collections",
    pages: "Pages",
    suggestions: "Suggestions",
    filters: "Filters",
    clearAll: "Clear all",
    apply: "Apply",
    sortBy: "Sort by",
    results: "{n} results",
    previous: "Previous",
    next: "Next",
    soldOut: "Sold out",
    sale: "Sale",
    viewPrice: "View price",
    min: "Min",
    max: "Max",
    inStock: "In stock",
    interpreted: "Showing results with filters from your search.",
    searchInstead: "Search for “{q}” instead",
  },
  appearance: {},
  templates: {},
  fixedPriceCountries: [],
  adjustedCountries: [],
};
config.filters.default = config.filters.search;

const toApi = (p: P) => ({
  id: p.id,
  gid: `gid://shopify/Product/${p.id}`,
  handle: p.title.toLowerCase().replace(/\s+/g, "-"),
  url: `/products/${p.id}`,
  title: p.title,
  vendor: p.vendor,
  product_type: "",
  available: p.available,
  price_min: p.price,
  price_max: p.price,
  discount_pct: 0,
  on_sale: false,
  currency: "USD",
  tags: [],
  variants: [],
  badges: p.available ? [] : ["sold_out"],
});

export type MockState = { storefrontCalls: number; searchCalls: number; fail?: boolean };

export async function mockApi(
  page: Page,
  state: MockState = { storefrontCalls: 0, searchCalls: 0 },
) {
  await page.route("**/apps/search/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (state.fail)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"engine_unavailable"}',
      });
    const path = url.pathname.split("/v1/")[1];
    if (path === "config") return route.fulfill({ json: config });
    if (path === "events") return route.fulfill({ status: 204 });
    let q = (url.searchParams.get("q") ?? "").toLowerCase();
    const filters = JSON.parse(url.searchParams.get("filters") ?? "{}") as {
      vendor?: string[];
      price?: { min?: number; max?: number };
      availability?: boolean;
    };
    let list = PRODUCTS.filter((p) => !q || p.title.toLowerCase().includes(q.slice(0, 3)));
    if (path === "suggest") {
      return route.fulfill({
        json: {
          query: q,
          products: list.slice(0, 3).map(toApi),
          collections: [{ title: "Summer", url: "/collections/summer", handle: "summer" }],
          pages: [],
          articles: [],
          suggestions: ["shirt classic"],
          total_products: list.length,
          currency: "USD",
        },
      });
    }
    state.searchCalls++;
    // Hiểu truy vấn (5.2): "nike shoes" → q "shoes" + vendor Nike, trừ khi khách chọn tìm đúng cụm (understand=0).
    let interpreted: unknown;
    if (q === "nike shoes" && url.searchParams.get("understand") !== "0") {
      interpreted = { query: "shoes", original: "nike shoes", filters: { vendor: ["Nike"] } };
      q = "shoes";
      filters.vendor = ["Nike"];
      list = PRODUCTS.filter((p) => p.title.toLowerCase().includes(q.slice(0, 3)));
    }
    const facetBase = list;
    if (filters.vendor?.length) list = list.filter((p) => filters.vendor!.includes(p.vendor));
    if (filters.price?.min !== undefined)
      list = list.filter((p) => p.price >= filters.price!.min! * 100);
    if (filters.price?.max !== undefined)
      list = list.filter((p) => p.price <= filters.price!.max! * 100);
    if (filters.availability) list = list.filter((p) => p.available);
    const sort = url.searchParams.get("sort") ?? "relevance";
    if (sort === "price_asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price_desc") list = [...list].sort((a, b) => b.price - a.price);
    const per = Number(url.searchParams.get("per_page") ?? 24);
    const pageNo = Number(url.searchParams.get("page") ?? 1);
    const vendors = [...new Set(facetBase.map((p) => p.vendor))];
    return route.fulfill({
      json: {
        query: q,
        interpreted,
        corrected_query: null,
        redirect: null,
        total: list.length,
        page: pageNo,
        per_page: per,
        sort,
        sort_options: config.sortOptions.filter((o) => q || o.key !== "relevance"),
        products: list.slice((pageNo - 1) * per, pageNo * per).map(toApi),
        facets: [
          {
            key: "availability",
            label: "Availability",
            type: "toggle",
            param: "filter.v.availability",
            values: [
              {
                value: "true",
                count: facetBase.filter((p) => p.available).length,
                selected: Boolean(filters.availability),
              },
            ],
            collapsed: false,
            showCount: true,
          },
          {
            key: "price",
            label: "Price",
            type: "range",
            param: "filter.v.price",
            min: 1900,
            max: 9000,
            currency: "USD",
            collapsed: false,
            ...(filters.price ? { selected: filters.price } : {}),
          },
          {
            key: "vendor",
            label: "Brand",
            type: "checkbox",
            param: "filter.p.vendor",
            values: vendors.map((v) => ({
              value: v,
              count: facetBase.filter((p) => p.vendor === v).length,
              selected: Boolean(filters.vendor?.includes(v)),
            })),
            collapsed: false,
            showCount: true,
          },
        ],
        applied_filters: filters,
        currency: "USD",
        took_ms: 1,
        ...(path === "collection" ? { collection: { id: "77", handle: "summer" } } : {}),
      },
    });
  });
  await page.route("**/api/2026-10/graphql.json", async (route: Route) => {
    state.storefrontCalls++;
    const body = JSON.parse(route.request().postData() ?? "{}") as { variables: { ids: string[] } };
    const nodes = body.variables.ids.map((gid) => {
      const p = PRODUCTS.find((x) => `gid://shopify/Product/${x.id}` === gid)!;
      if (p.id === "4") return null; // không bán ở DE
      const eur = ((p.price * 0.9) / 100).toFixed(2);
      return {
        id: gid,
        availableForSale: p.available,
        priceRange: {
          minVariantPrice: { amount: eur, currencyCode: "EUR" },
          maxVariantPrice: { amount: eur, currencyCode: "EUR" },
        },
        compareAtPriceRange: { maxVariantPrice: null },
      };
    });
    return route.fulfill({ json: { data: { nodes } } });
  });
  await page.route("**/products/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Product</title><h1>Product page</h1>",
    }),
  );
  return state;
}
