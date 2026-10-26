import { Client } from "./client";
import { Emitter } from "./events";
import { currencyExponent, formatMoney, intlMoney } from "./money";
import type { ApiProduct, Pricer } from "./pricing";
import { readState, writeState } from "./state";
import { render } from "./template";
import type {
  CollectionParams,
  Facet,
  Filters,
  MountOptions,
  Product,
  PublicConfig,
  SearchAppContext,
  SearchAppEvent,
  SearchAppSDK,
  SearchParams,
  SearchResponse,
  SuggestResponse,
  UrlState,
  Widget,
  WidgetFactory,
} from "./types";

export const VERSION = "1.1.0";

type RawResponse = Omit<SearchResponse, "products" | "pages"> & { products: ApiProduct[] };

export type SdkDeps = {
  fetch?: typeof fetch;
  pricer?: Pricer;
  win?: Pick<Window, "location" | "history"> & Partial<Pick<Window, "addEventListener">>;
};

const sameCurrencyPricer = (): Pricer => ({
  needsLocalPrice: () => false,
  localize: async () => ({ prices: new Map(), currency: "", rate: 1, ok: true }),
  rate: () => 1,
});

export function createSDK(ctx: SearchAppContext, deps: SdkDeps = {}): SearchAppSDK {
  const client = new Client(ctx, deps.fetch);
  const bus = new Emitter();
  const pricer = deps.pricer ?? sameCurrencyPricer();
  const win = deps.win ?? (typeof window !== "undefined" ? window : undefined);
  const widgets = new Map<string, WidgetFactory>();
  const pending: [HTMLElement, MountOptions][] = [];
  let configP: Promise<PublicConfig> | undefined;
  let lastFilters: PublicConfig["filters"]["default"] = [];

  const queue: unknown[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  // Tải lười: trang không dùng widget không tốn request /config (Lighthouse, task 2.14).
  const getConfig = () =>
    (configP ??= client.get<PublicConfig>("config", {}, 300_000).then((c) => {
      lastFilters = ctx.collection ? c.filters.default : c.filters.search;
      return c;
    }));

  /** Thị trường có giá cố định trong index → API trả giá theo currency market, không quy đổi. */
  const fixedMarket = async () => (await getConfig()).fixedPriceCountries.includes(ctx.country);

  const fmt = (minor: number, currency: string) =>
    currency === ctx.currency
      ? formatMoney(minor, currency, ctx.moneyFormat)
      : intlMoney(minor, currency, ctx.locale);

  /** Khoảng giá khách chọn (currency đang xem) → currency gốc trước khi gửi (mục 6.2). */
  async function toApiFilters(filters: Filters | undefined): Promise<string | undefined> {
    if (!filters || !Object.keys(filters).length) return undefined;
    const cfg = await getConfig();
    const fixed = await fixedMarket();
    const rate = fixed ? 1 : pricer.rate();
    const out: Filters = {};
    for (const [k, v] of Object.entries(filters)) {
      const f = cfg.filters.default.concat(cfg.filters.search).find((x) => x.id === k);
      if (f?.source === "price" && v && typeof v === "object" && !Array.isArray(v) && rate !== 1) {
        out[k] = {
          ...(v.min !== undefined ? { min: Math.floor((v.min / rate) * 100) / 100 } : {}),
          ...(v.max !== undefined ? { max: Math.ceil((v.max / rate) * 100) / 100 } : {}),
        };
      } else out[k] = v;
    }
    return JSON.stringify(out);
  }

  async function localize(raw: RawResponse): Promise<SearchResponse> {
    const base = raw.currency;
    const fixed = await fixedMarket();
    const cfg = await getConfig().catch(() => null);
    const useLocal =
      !fixed && pricer.needsLocalPrice(Boolean(cfg?.adjustedCountries.includes(ctx.country)));
    const loc = useLocal
      ? await pricer.localize(raw.products)
      : { prices: new Map(), currency: base, rate: 1, ok: true };
    // Observability (6.1): tỷ lệ lỗi lấy giá Storefront — lỗi gửi hết, thành công lấy mẫu 10% (đỡ beacon).
    if (useLocal && raw.products.length && (!loc.ok || Math.random() < 0.1)) {
      queue.push({ type: "pricing", ok: loc.ok, sample: loc.ok ? 0.1 : 1 });
      flushTimer ??= setTimeout(flush, 2000);
    }
    const currency = useLocal ? loc.currency || ctx.currency : base;
    const products: Product[] = [];
    for (const p of raw.products) {
      const lp = useLocal ? loc.prices.get(p.gid) : undefined;
      if (useLocal && loc.ok && lp === null) continue; // không bán ở market của khách (D15)
      const min = lp ? lp.min : (p.price_min as number);
      const max = lp ? lp.max : (p.price_max as number);
      const cmp = lp ? lp.compareAtMax : (p.compare_at_max as number | undefined);
      const ready = !useLocal || (loc.ok && Boolean(lp));
      products.push({
        ...(p as unknown as Product),
        price_min: min,
        price_max: max,
        compare_at_max: cmp,
        currency,
        available: lp ? lp.available && (p.available as boolean) : (p.available as boolean),
        price: ready ? fmt(min, currency) : null,
        compare_at_price: ready && cmp && cmp > min ? fmt(cmp, currency) : null,
        priceReady: ready,
      });
    }
    const r = useLocal ? loc.rate : 1;
    const facets: Facet[] = raw.facets.map((f) =>
      f.type === "range" && f.currency
        ? {
            ...f,
            currency,
            min: Math.floor(((f.min as number) / 10 ** currencyExponent(base)) * r),
            max: Math.ceil(((f.max as number) / 10 ** currencyExponent(base)) * r),
          }
        : f,
    );
    return {
      ...raw,
      products,
      facets,
      currency,
      pages: Math.max(1, Math.ceil(raw.total / Math.max(1, raw.per_page))),
    };
  }

  async function run(
    path: string,
    params: SearchParams & { collection?: string },
  ): Promise<SearchResponse> {
    const detail = { params: { ...params } };
    if (!bus.emit("before-search", detail, true)) throw new Error("search cancelled");
    const p = detail.params;
    const url = sdk.state.get();
    // Tìm theo URL (q trùng q trên URL): hiểu truy vấn (5.2) có thể ghi lại URL; "Tìm đúng cụm" → understand=0.
    const fromUrl = path === "search" && (p.q ?? "") === (url.q ?? "");
    try {
      const raw = await client.get<RawResponse>(path, {
        q: p.q,
        collection: p.collection,
        sort: p.sort,
        page: p.page,
        per_page: p.perPage,
        fields: p.fields?.join(","),
        filters: await toApiFilters(p.filters),
        currency: ctx.currency,
        understand: fromUrl && url.literal ? 0 : undefined,
      });
      if (raw.interpreted && fromUrl && win) {
        // Đưa filter đã hiểu lên URL (không phát event: kết quả này đã tính với chúng) → khách bỏ được như filter thường.
        const next = {
          ...url,
          q: raw.interpreted.query,
          filters: { ...raw.interpreted.filters, ...url.filters },
          original: raw.interpreted.original,
        };
        win.history.replaceState(
          { searchapp: true },
          "",
          win.location.pathname + writeState(next, lastFilters, win.location.search),
        );
      }
      const res = await localize(raw);
      bus.emit("results", res);
      return res;
    } catch (e) {
      bus.emit("error", e);
      throw e;
    }
  }

  function flush() {
    flushTimer = undefined;
    if (queue.length) client.beacon(queue.splice(0));
  }

  const sdk: SearchAppSDK = {
    version: VERSION,
    context: ctx,
    ready: () => Promise.resolve(sdk),
    search: async (params = {}) => {
      // Cần cây filter để đọc filter.* từ URL.
      await getConfig().catch(() => null);
      const st = sdk.state.get();
      return run("search", {
        q: st.q,
        filters: st.filters,
        sort: st.sort,
        page: st.page,
        ...params,
      });
    },
    collection: (handle, params: CollectionParams = {}) =>
      run("collection", { ...params, collection: handle }),
    suggest: async (q, options = {}) => {
      const raw = await client.get<
        Omit<SuggestResponse, "products"> & { products: ApiProduct[]; currency: string }
      >("suggest", {
        q,
        limit: options.limit,
      });
      const res = await localize({
        ...(raw as unknown as RawResponse),
        facets: [],
        total: raw.total_products,
        per_page: 1,
      });
      return { ...raw, products: res.products };
    },
    getConfig,
    formatMoney: (minor, currency = ctx.currency) => fmt(minor, currency),
    track(type, data) {
      queue.push({ type, ...data });
      flushTimer ??= setTimeout(flush, 2000);
    },
    state: {
      get(): UrlState {
        const search = win?.location.search ?? "";
        // Đọc đồng bộ: dùng cây filter đã tải (nếu chưa có thì chỉ q/sort/page).
        return readState(search, lastFilters);
      },
      set(next, options = {}) {
        if (!win) return;
        const cur = sdk.state.get();
        const merged: UrlState = { ...cur, ...next, filters: next.filters ?? cur.filters };
        // Khách đổi từ khoá → bỏ ghi chú "đã hiểu" / chế độ tìm đúng cụm của từ khoá cũ.
        if (next.q !== undefined && next.q !== cur.q && next.original === undefined) {
          delete merged.original;
          delete merged.literal;
        }
        const url = win.location.pathname + writeState(merged, lastFilters, win.location.search);
        win.history[options.replace ? "replaceState" : "pushState"]({ searchapp: true }, "", url);
        if (next.filters) bus.emit("filters:change", merged.filters);
        if (next.sort !== undefined && next.sort !== cur.sort) bus.emit("sort:change", next.sort);
      },
    },
    on: (e: SearchAppEvent, fn) => bus.on(e, fn),
    off: (e: SearchAppEvent, fn) => bus.off(e, fn),
    registerWidget(type, factory) {
      widgets.set(type, factory);
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i][1].type === type) {
          const [el, opts] = pending.splice(i, 1)[0];
          factory(el, opts, sdk);
        }
      }
    },
    mount(target, options): Widget | void {
      const el =
        typeof target === "string"
          ? (document.querySelector(target) as HTMLElement | null)
          : target;
      if (!el) return;
      const factory = widgets.get(options.type);
      if (!factory) {
        pending.push([el, options]);
        return;
      }
      bus.emit("render", { type: options.type, el });
      return factory(el, options, sdk);
    },
    render: (template, data) => render(template, data, { money: (v) => fmt(v, ctx.currency) }),
  };

  win?.addEventListener?.("pagehide", flush);
  return sdk;
}

/** data-searchapp-mount="results" data-per-page="24" … (mục 6.4e). */
export function autoMount(sdk: SearchAppSDK, root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-searchapp-mount]").forEach((el) => {
    if (el.dataset.searchappMounted) return;
    const { searchappMount, ...rest } = el.dataset;
    el.dataset.searchappMounted = "1";
    sdk.mount(el, { ...rest, type: searchappMount! });
  });
}
