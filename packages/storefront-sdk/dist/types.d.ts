/** Storefront context printed by the app embed (Liquid snippet `sa-config`). */
export interface SearchAppContext {
    shop: string;
    publicKey: string;
    /** API base: the same-origin app proxy (for example `/apps/search`) or the search API URL. */
    apiBase: string;
    /** `true` when `apiBase` is the app proxy (no `shop`/`key` parameters needed). */
    proxy?: boolean;
    country: string;
    language: string;
    /** Currency the shopper is browsing in (`cart.currency.iso_code`). */
    currency: string;
    /** The shop's base currency. */
    shopCurrency: string;
    /** The theme's money format for the shopper's currency, for example `${{amount}}`. */
    moneyFormat: string;
    moneyWithCurrencyFormat?: string;
    locale: string;
    pageType?: string;
    collection?: {
        id: string;
        handle: string;
    } | null;
    searchTerms?: string;
    /** Storefront API settings used for market pricing. */
    storefront?: {
        endpoint?: string;
        version?: string;
    };
    /** The theme's search page path (`routes.search_url`). */
    searchUrl?: string;
    /** Widget stylesheet URL (loaded lazily by the instant search dropdown, never render-blocking). */
    cssUrl?: string;
}
export type FilterValue = string[] | {
    min?: number;
    max?: number;
} | boolean;
/** Selected filters keyed by filter id (configured in the app admin). Price ranges use the shopper's currency. */
export type Filters = Record<string, FilterValue>;
/** Parameters for `search()`. */
export interface SearchParams {
    /** Search terms. Empty returns all products (useful with filters). */
    q?: string;
    /** Selected filters, keyed by filter id from `getConfig().filters`. */
    filters?: Filters;
    /** Sort key from `sort_options`, for example `price_asc`. Defaults to the shop's default sort. */
    sort?: string;
    /** 1-based page number. */
    page?: number;
    /** Products per page (max 48). */
    perPage?: number;
    /** Only return these product fields, for a lighter response. */
    fields?: string[];
}
/** Parameters for `collection()`. `q` narrows results within the collection. */
export interface CollectionParams extends Omit<SearchParams, "q"> {
    q?: string;
}
export interface Money {
    /** Amount in minor units (cents). */
    amount: number;
    currency: string;
}
export interface Product {
    id: string;
    gid: string;
    handle: string;
    url: string;
    title: string;
    vendor: string;
    product_type: string;
    image?: string;
    image_alt?: string;
    image_2?: string;
    available: boolean;
    /** Price localized to the shopper's market, in minor units of `currency`. */
    price_min: number;
    price_max: number;
    compare_at_max?: number;
    currency: string;
    /** Price formatted with the theme's money format; `null` when the correct price isn't available (show "View price"). */
    price: string | null;
    compare_at_price: string | null;
    on_sale: boolean;
    discount_pct: number;
    tags: string[];
    variants: {
        id: string;
        title: string;
        sku?: string;
        price: number;
        compare_at?: number;
        available: boolean;
        options: string[];
    }[];
    badges: string[];
    /** `false` when the price couldn't be confirmed in the shopper's currency; the default UI then shows "View price". */
    priceReady: boolean;
}
export interface FacetValue {
    value: string;
    label?: string;
    count: number;
    selected: boolean;
}
export interface ListFacet {
    key: string;
    label: string;
    type: "checkbox" | "radio" | "swatch" | "toggle";
    param: string;
    values: FacetValue[];
    collapsed: boolean;
    showCount: boolean;
}
export interface RangeFacet {
    key: string;
    label: string;
    type: "range";
    param: string;
    /** Converted to the shopper's currency, in major units. */
    min: number;
    max: number;
    selected?: {
        min?: number;
        max?: number;
    };
    currency?: string;
    collapsed: boolean;
}
export type Facet = ListFacet | RangeFacet;
export interface SortOption {
    key: string;
    label: string;
}
/** Result of `search()` and `collection()`. Prices are already localized to the shopper's market. */
export interface SearchResponse {
    query: string;
    /** Set when the merchant configured a redirect for this query; navigate there instead of rendering. */
    redirect: string | null;
    /** Total matching products. */
    total: number;
    page: number;
    per_page: number;
    pages: number;
    sort: string;
    sort_options: SortOption[];
    products: Product[];
    /** Facets with counts (list facets) or min/max (range facets), in the merchant's configured order. */
    facets: Facet[];
    applied_filters: Filters;
    /** Currency of `price_min` / `price_max` on products. */
    currency: string;
    collection?: {
        id: string;
        handle: string;
    };
    /**
     * Set when the merchant turned on query understanding and words in the search became filters: `query` is what
     * was searched, `filters` were added (prices in `currency`). The SDK writes both to the URL so shoppers can remove them.
     */
    interpreted?: {
        query: string;
        original: string;
        filters: Filters;
    };
}
/** Result of `suggest()` for instant search. */
export interface SuggestResponse {
    query: string;
    products: Product[];
    collections: {
        title: string;
        url: string;
        handle: string;
    }[];
    pages: {
        title: string;
        url: string;
    }[];
    articles: {
        title: string;
        url: string;
    }[];
    suggestions: string[];
    total_products: number;
}
export interface PublicFilter {
    id: string;
    label: string;
    type: "checkbox" | "radio" | "swatch" | "range" | "toggle";
    source: string;
    param: string;
    collapsed: boolean;
    showCount: boolean;
}
export interface PublicConfig {
    version: string;
    locale: string;
    shop: {
        currency: string;
        primaryLocale: string;
        locales: string[];
    };
    searchTypes: Record<"products" | "collections" | "pages" | "articles", {
        autocomplete: boolean;
        results: boolean;
    }>;
    sortOptions: SortOption[];
    sortDefaults: {
        search: string;
    };
    filters: {
        default: PublicFilter[];
        search: PublicFilter[];
    };
    texts: Record<string, string>;
    appearance: Record<string, unknown>;
    /** CSS custom properties (`--sa-*`) set in the app admin under Appearance. */
    cssVars?: Record<string, string>;
    showVendor?: boolean;
    templates: Record<string, string>;
    fixedPriceCountries: string[];
    adjustedCountries: string[];
}
/** Search state mirrored in the URL using Shopify's native parameters (`q`, `filter.p.*`, `filter.v.*`, `sort_by`, `page`). */
export interface UrlState {
    q?: string;
    filters: Filters;
    sort?: string;
    page?: number;
    /** What the shopper typed, when the app turned words like "red" or "under $50" into filters (`sa_orig`). */
    original?: string;
    /** Search the exact words, without turning them into filters (`sa_literal=1`). */
    literal?: boolean;
}
/**
 * Events for `on()` / `off()`. Each is also dispatched on `document` as a `CustomEvent` named `searchapp:<event>`
 * with `:` replaced by `-` (for example `searchapp:filters-change`), with the payload in `detail`.
 */
export type SearchAppEvent = "ready" | "before-search" | "results" | "render" | "filters:change" | "sort:change" | "error";
/** Options for `mount()`. Extra keys are passed to the widget (for example `perPage`, `collection`). */
export interface MountOptions {
    /** Widget type: built-in `search-page` (alias `results`), `instant`, or a type added with `registerWidget()`. */
    type: "results" | "filters" | "sort" | "pagination" | "instant" | string;
    /** Selector or `<template>` element that overrides the default markup (`data-searchapp="product-card"`, …). */
    template?: string | HTMLTemplateElement;
    [option: string]: unknown;
}
/** Handle returned by a widget factory. */
export interface Widget {
    update?(res: SearchResponse): void;
    destroy?(): void;
}
/** Creates a widget inside `el`. Register it with `registerWidget()`. */
export type WidgetFactory = (el: HTMLElement, options: MountOptions, sdk: SearchAppSDK) => Widget | void;
/** The global `window.SearchApp` object (SDK v1). */
export interface SearchAppSDK {
    /** SDK version (semver). */
    readonly version: string;
    /** Storefront context from the app embed. */
    readonly context: SearchAppContext;
    /**
     * Resolves once the SDK has loaded. The app embed defines a stub that loads the SDK on demand; it renders at the
     * end of `<body>`, so call this after `DOMContentLoaded` from section scripts.
     */
    ready(): Promise<SearchAppSDK>;
    /** Searches products with the merchant's relevance, synonyms, merchandising rules and market prices. */
    search(params?: SearchParams): Promise<SearchResponse>;
    /** Instant search suggestions: products, collections, pages, articles and query suggestions. */
    suggest(q: string, options?: {
        limit?: number;
    }): Promise<SuggestResponse>;
    /** Filters and sorts products within a collection (by handle). */
    collection(handle: string, params?: CollectionParams): Promise<SearchResponse>;
    /** Public configuration: filters, sort options, texts and appearance. Cached for the page. */
    getConfig(): Promise<PublicConfig>;
    /** Formats minor units with the theme's money format. Defaults to the shopper's currency. */
    formatMoney(minorUnits: number, currency?: string): string;
    /**
     * Records an anonymous analytics event for search insights. `click` accepts `source`
     * (`"search"`, `"collection"`, `"instant"`) and `collectionId`; `filter` accepts `scope` (`"search"` or a collection id).
     */
    track(type: "click" | "add_to_cart" | "filter" | "filter_combo" | "sort" | "collection_view" | "suggestion", data: Record<string, unknown>): void;
    /** Reads and writes the search state in the URL. `set()` pushes a history entry unless `replace` is true. */
    state: {
        get(): UrlState;
        set(next: Partial<UrlState>, options?: {
            replace?: boolean;
        }): void;
    };
    /** Subscribes to an event. Returns an unsubscribe function. */
    on(event: SearchAppEvent, handler: (payload: unknown) => void): () => void;
    /** Removes a handler added with `on()`. */
    off(event: SearchAppEvent, handler: (payload: unknown) => void): void;
    /** Mounts a widget into an element or selector. Waits if the widget type isn't registered yet. */
    mount(el: HTMLElement | string, options: MountOptions): Widget | void;
    /** Adds a widget type that `mount()` and `data-searchapp-mount` can use. */
    registerWidget(type: string, factory: WidgetFactory): void;
    /** Renders a template with the SDK's safe template engine (all output is HTML-escaped). */
    render(template: string, data: unknown): string;
}
