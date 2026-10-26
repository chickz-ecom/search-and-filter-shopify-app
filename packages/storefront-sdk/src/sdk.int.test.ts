// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Pricer } from "./pricing";
import { autoMount, createSDK } from "./sdk";
import type { SearchAppContext } from "./types";

const ctx: SearchAppContext = {
  shop: "s.myshopify.com",
  publicKey: "pk_1",
  apiBase: "https://api.example",
  country: "US",
  language: "EN",
  currency: "USD",
  shopCurrency: "USD",
  moneyFormat: "${{amount}}",
  locale: "en",
};

const config = {
  version: "1",
  locale: "en",
  shop: { currency: "USD", primaryLocale: "en", locales: ["en"] },
  searchTypes: {},
  sortOptions: [],
  sortDefaults: { search: "relevance" },
  filters: {
    default: [],
    search: [
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
  texts: {},
  appearance: {},
  templates: {},
  fixedPriceCountries: [],
  adjustedCountries: [],
};

const product = (id: string, price: number) => ({
  id,
  gid: `gid://shopify/Product/${id}`,
  handle: `p-${id}`,
  url: `/products/p-${id}`,
  title: `P${id}`,
  price_min: price,
  price_max: price,
  currency: "USD",
  available: true,
  badges: [],
  variants: [],
});

function api(handler: (url: URL) => unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/config")) return new Response(JSON.stringify(config));
    return new Response(JSON.stringify(handler(url)));
  }) as unknown as typeof fetch;
}

const win = (search = "") => {
  const w = {
    location: { search, pathname: "/search", href: `https://shop.test/search${search}` },
    history: { pushState: vi.fn(), replaceState: vi.fn() },
  };
  return w as unknown as Window;
};

describe("SearchApp SDK", () => {
  it("search(): reads URL state, sends shop/key/locale, formats prices with the theme format", async () => {
    let seen: URL | undefined;
    const fetchImpl = api((u) => {
      seen = u;
      return {
        query: "dress",
        redirect: null,
        total: 30,
        page: 1,
        per_page: 24,
        sort: "relevance",
        sort_options: [],
        products: [product("1", 1999)],
        facets: [],
        applied_filters: {},
        currency: "USD",
      };
    });
    const sdk = createSDK(ctx, { fetch: fetchImpl, win: win("?q=dress&filter.p.vendor=Nike") });
    await sdk.getConfig();
    const res = await sdk.search();
    expect(seen?.searchParams.get("q")).toBe("dress");
    expect(seen?.searchParams.get("shop")).toBe("s.myshopify.com");
    expect(seen?.searchParams.get("key")).toBe("pk_1");
    expect(JSON.parse(seen!.searchParams.get("filters")!)).toEqual({ vendor: ["Nike"] });
    expect(res.products[0]).toMatchObject({ price: "$19.99", priceReady: true });
    expect(res.pages).toBe(2);
  });

  it("before-search can modify params; results/error events fire", async () => {
    const fetchImpl = api(() => ({
      query: "",
      redirect: null,
      total: 0,
      page: 1,
      per_page: 24,
      sort: "x",
      sort_options: [],
      products: [],
      facets: [],
      applied_filters: {},
      currency: "USD",
    }));
    const sdk = createSDK(ctx, { fetch: fetchImpl, win: win() });
    sdk.on(
      "before-search",
      (d) => ((d as { params: { sort?: string } }).params.sort = "price_asc"),
    );
    const results = vi.fn();
    sdk.on("results", results);
    await sdk.search({ q: "x" });
    const call = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.find((c) =>
      String(c[0]).includes("/v1/search"),
    );
    expect(new URL(String(call![0])).searchParams.get("sort")).toBe("price_asc");
    expect(results).toHaveBeenCalled();
  });

  it("localizes prices via the pricer, hides products not sold in the market, converts price ranges", async () => {
    let filtersSent = "";
    const fetchImpl = api((u) => {
      filtersSent = u.searchParams.get("filters") ?? "";
      return {
        query: "",
        redirect: null,
        total: 2,
        page: 1,
        per_page: 24,
        sort: "x",
        sort_options: [],
        applied_filters: {},
        currency: "USD",
        products: [product("1", 1000), product("2", 2000)],
        facets: [
          {
            key: "price",
            label: "Price",
            type: "range",
            param: "filter.v.price",
            min: 1000,
            max: 2000,
            currency: "USD",
            collapsed: false,
          },
        ],
      };
    });
    const pricer: Pricer = {
      needsLocalPrice: () => true,
      rate: () => 0.9,
      localize: async () => ({
        prices: new Map([
          ["gid://shopify/Product/1", { min: 900, max: 900, available: true }],
          ["gid://shopify/Product/2", null],
        ]),
        currency: "EUR",
        rate: 0.9,
        ok: true,
      }),
    };
    const sdk = createSDK(
      { ...ctx, currency: "EUR", moneyFormat: "{{amount_with_comma_separator}} €" },
      { fetch: fetchImpl, pricer, win: win() },
    );
    const res = await sdk.search({ filters: { price: { min: 9, max: 18 } } });
    expect(JSON.parse(filtersSent)).toEqual({ price: { min: 10, max: 20 } }); // 9 € / 0.9 = 10 $
    expect(res.products.map((p) => [p.id, p.price, p.currency])).toEqual([["1", "9,00 €", "EUR"]]);
    expect(res.facets[0]).toMatchObject({ min: 9, max: 18, currency: "EUR" });
  });

  it("shows 'view price' (price null) when localization fails rather than a wrong currency", async () => {
    const fetchImpl = api(() => ({
      query: "",
      redirect: null,
      total: 1,
      page: 1,
      per_page: 24,
      sort: "x",
      sort_options: [],
      products: [product("1", 1000)],
      facets: [],
      applied_filters: {},
      currency: "USD",
    }));
    const pricer: Pricer = {
      needsLocalPrice: () => true,
      rate: () => 1,
      localize: async () => ({ prices: new Map(), currency: "EUR", rate: 1, ok: false }),
    };
    const res = await createSDK(
      { ...ctx, currency: "EUR" },
      { fetch: fetchImpl, pricer, win: win() },
    ).search({});
    expect(res.products[0]).toMatchObject({ price: null, priceReady: false });
  });

  it("state.set writes native URL params and emits events", async () => {
    const w = win("?q=a");
    const sdk = createSDK(ctx, { fetch: api(() => ({})), win: w });
    await sdk.getConfig();
    const changed = vi.fn();
    sdk.on("filters:change", changed);
    sdk.state.set({ filters: { vendor: ["Nike"] }, page: 2 });
    expect(
      (w.history.pushState as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][2],
    ).toBe("/search?q=a&filter.p.vendor=Nike&page=2");
    expect(changed).toHaveBeenCalledWith({ vendor: ["Nike"] });
  });

  it("mounts widgets declared with data-searchapp-mount once the widget registers", () => {
    document.body.innerHTML =
      '<div id="w" data-searchapp-mount="results" data-per-page="12"></div>';
    const sdk = createSDK(ctx, { fetch: api(() => ({})), win: win() });
    autoMount(sdk);
    const factory = vi.fn();
    sdk.registerWidget("results", factory);
    expect(factory).toHaveBeenCalledWith(
      document.getElementById("w"),
      { type: "results", perPage: "12" },
      sdk,
    );
  });

  it("batches track() events into one beacon", async () => {
    vi.useFakeTimers();
    const send = vi.fn<(url: string, body: string) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: send, configurable: true });
    const sdk = createSDK(ctx, { fetch: api(() => ({})), win: win() });
    sdk.track("click", { productId: "1", position: 1 });
    sdk.track("click", { productId: "2", position: 2 });
    vi.advanceTimersByTime(2100);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1]).events).toHaveLength(2);
    vi.useRealTimers();
  });

  it("renders templates with theme money formatting", () => {
    const sdk = createSDK(ctx, { fetch: api(() => ({})), win: win() });
    expect(sdk.render("{{title}} {{price_min | money}}", { title: "<b>", price_min: 500 })).toBe(
      "&lt;b&gt; $5.00",
    );
  });

  it("query understanding: writes the interpreted query + filters to the URL without a reload event", async () => {
    let seen: URL | undefined;
    const fetchImpl = api((u) => {
      seen = u;
      return {
        query: "dress",
        redirect: null,
        total: 3,
        page: 1,
        per_page: 24,
        sort: "relevance",
        sort_options: [],
        products: [product("1", 1999)],
        facets: [],
        applied_filters: {},
        currency: "USD",
        interpreted: {
          query: "dress",
          original: "nike dress under $50",
          filters: { vendor: ["Nike"], price: { max: 50 } },
        },
      };
    });
    const w = win("?q=nike+dress+under+%2450");
    const sdk = createSDK(ctx, { fetch: fetchImpl, win: w });
    const changed = vi.fn();
    sdk.on("filters:change", changed);
    const res = await sdk.search();
    expect(seen?.searchParams.get("currency")).toBe("USD");
    expect(seen?.searchParams.has("understand")).toBe(false);
    expect(res.interpreted?.query).toBe("dress");
    const url = new URL(
      `https://x${(w.history.replaceState as ReturnType<typeof vi.fn>).mock.calls[0][2]}`,
    );
    expect(url.searchParams.get("q")).toBe("dress");
    expect(url.searchParams.get("filter.p.vendor")).toBe("Nike");
    expect(url.searchParams.get("filter.v.price.lte")).toBe("50");
    expect(url.searchParams.get("sa_orig")).toBe("nike dress under $50");
    expect(changed).not.toHaveBeenCalled();
  });

  it("'search instead' (sa_literal=1) asks the API not to interpret; a new query drops the note", async () => {
    let seen: URL | undefined;
    const fetchImpl = api((u) => {
      seen = u;
      return {
        query: "x",
        redirect: null,
        total: 0,
        page: 1,
        per_page: 24,
        sort: "relevance",
        sort_options: [],
        products: [],
        facets: [],
        applied_filters: {},
        currency: "USD",
      };
    });
    const w = win("?q=nike+dress&sa_orig=nike+dress&sa_literal=1");
    const sdk = createSDK(ctx, { fetch: fetchImpl, win: w });
    await sdk.search();
    expect(seen?.searchParams.get("understand")).toBe("0");
    // search() với từ khoá khác (không theo URL) → không gửi understand=0.
    await sdk.search({ q: "boots" });
    expect(seen?.searchParams.has("understand")).toBe(false);
    sdk.state.set({ q: "boots" });
    const pushed = (w.history.pushState as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(pushed).toContain("q=boots");
    expect(pushed).not.toContain("sa_orig");
    expect(pushed).not.toContain("sa_literal");
  });
});
