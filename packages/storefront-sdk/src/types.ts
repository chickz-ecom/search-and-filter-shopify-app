// Hợp đồng công khai SDK v1 (D16). Đổi chữ ký nào → cập nhật docs/developers/ + CHANGELOG; chỉ break ở major.

/** Context do app embed in sẵn bằng Liquid (snippet sa-config). */
export interface SearchAppContext {
  shop: string;
  publicKey: string;
  /** Gốc API: app proxy same-origin (vd. "/apps/search") hoặc URL search-api. */
  apiBase: string;
  /** true khi apiBase là app proxy (không cần gửi shop/key). */
  proxy?: boolean;
  country: string;
  language: string;
  /** Currency khách đang xem (cart.currency.iso_code). */
  currency: string;
  /** Currency gốc của shop. */
  shopCurrency: string;
  /** Mẫu tiền của theme cho currency khách đang xem, vd. "${{amount}}". */
  moneyFormat: string;
  moneyWithCurrencyFormat?: string;
  locale: string;
  pageType?: string;
  collection?: { id: string; handle: string } | null;
  searchTerms?: string;
  /** Storefront API (giá theo market — D15). */
  storefront?: { endpoint?: string; version?: string };
  /** Đường dẫn trang search của theme (routes.search_url). */
  searchUrl?: string;
  /** URL stylesheet của widget (dropdown instant nạp lười, không chặn render). */
  cssUrl?: string;
}

export type FilterValue = string[] | { min?: number; max?: number } | boolean;
/** Filter đã chọn theo id filter (cấu hình ở admin). Khoảng giá tính theo currency khách đang xem. */
export type Filters = Record<string, FilterValue>;

export interface SearchParams {
  q?: string;
  filters?: Filters;
  sort?: string;
  page?: number;
  perPage?: number;
  /** Chỉ lấy một số field sản phẩm để response nhẹ hơn. */
  fields?: string[];
}

export interface CollectionParams extends Omit<SearchParams, "q"> {
  q?: string;
}

export interface Money {
  /** Đơn vị nhỏ nhất (cent). */
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
  /** Giá đã localize theo market của khách (minor units của `currency`). */
  price_min: number;
  price_max: number;
  compare_at_max?: number;
  currency: string;
  /** Chuỗi đã format theo moneyFormat của theme; null khi không lấy được giá đúng ("Xem giá"). */
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
  /** false khi chưa chắc giá đúng currency (lỗi Storefront API) → UI hiện "Xem giá". */
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
  /** Đã quy đổi sang currency khách đang xem (đơn vị chính). */
  min: number;
  max: number;
  selected?: { min?: number; max?: number };
  currency?: string;
  collapsed: boolean;
}

export type Facet = ListFacet | RangeFacet;

export interface SortOption {
  key: string;
  label: string;
}

export interface SearchResponse {
  query: string;
  redirect: string | null;
  total: number;
  page: number;
  per_page: number;
  pages: number;
  sort: string;
  sort_options: SortOption[];
  products: Product[];
  facets: Facet[];
  applied_filters: Filters;
  currency: string;
  collection?: { id: string; handle: string };
}

export interface SuggestResponse {
  query: string;
  products: Product[];
  collections: { title: string; url: string; handle: string }[];
  pages: { title: string; url: string }[];
  articles: { title: string; url: string }[];
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
  shop: { currency: string; primaryLocale: string; locales: string[] };
  searchTypes: Record<
    "products" | "collections" | "pages" | "articles",
    { autocomplete: boolean; results: boolean }
  >;
  sortOptions: SortOption[];
  sortDefaults: { search: string };
  filters: { default: PublicFilter[]; search: PublicFilter[] };
  texts: Record<string, string>;
  appearance: Record<string, unknown>;
  templates: Record<string, string>;
  fixedPriceCountries: string[];
  adjustedCountries: string[];
}

export interface UrlState {
  q?: string;
  filters: Filters;
  sort?: string;
  page?: number;
}

export type SearchAppEvent =
  "ready" | "before-search" | "results" | "render" | "filters:change" | "sort:change" | "error";

export interface MountOptions {
  type: "results" | "filters" | "sort" | "pagination" | "instant" | string;
  /** Selector hoặc phần tử <template> ghi đè (data-searchapp="product-card"…). */
  template?: string | HTMLTemplateElement;
  [option: string]: unknown;
}

export interface Widget {
  update?(res: SearchResponse): void;
  destroy?(): void;
}

export type WidgetFactory = (
  el: HTMLElement,
  options: MountOptions,
  sdk: SearchAppSDK,
) => Widget | void;

export interface SearchAppSDK {
  readonly version: string;
  readonly context: SearchAppContext;
  ready(): Promise<SearchAppSDK>;
  search(params?: SearchParams): Promise<SearchResponse>;
  suggest(q: string, options?: { limit?: number }): Promise<SuggestResponse>;
  collection(handle: string, params?: CollectionParams): Promise<SearchResponse>;
  getConfig(): Promise<PublicConfig>;
  formatMoney(minorUnits: number, currency?: string): string;
  track(type: "click" | "add_to_cart" | "filter" | "sort", data: Record<string, unknown>): void;
  state: {
    get(): UrlState;
    set(next: Partial<UrlState>, options?: { replace?: boolean }): void;
  };
  on(event: SearchAppEvent, handler: (payload: unknown) => void): () => void;
  off(event: SearchAppEvent, handler: (payload: unknown) => void): void;
  mount(el: HTMLElement | string, options: MountOptions): Widget | void;
  registerWidget(type: string, factory: WidgetFactory): void;
  render(template: string, data: unknown): string;
}
