import type {
  Facet,
  Filters,
  MountOptions,
  Product,
  PublicConfig,
  SearchAppSDK,
  SearchResponse,
} from "../../storefront-sdk/src/index";
import { applyCssVars, EMPTY, PRODUCT_CARD, esc, fill, safeHref, templateFor } from "./templates";

// Widget "search-page" cho app block search-results / collection-filter (mục 7.2) và data-searchapp-mount.
// Liquid in sẵn grid native (SEO + fallback, D11); widget chỉ thay nội dung TRONG vùng của block khi có dữ liệu.
// Lỗi API → giữ nguyên grid native, không lỗi console (task 2.11).

type Opts = MountOptions & {
  mode?: string;
  collection?: string;
  perPage?: string;
  columns?: string;
  filterPosition?: string;
  showSort?: string;
  defaultSort?: string;
};

export class SearchPage {
  private cfg: PublicConfig | null = null;
  private last: SearchResponse | null = null;
  private loading = 0;
  private adopted = false;

  private readonly perPage: number;

  constructor(
    private readonly el: HTMLElement,
    private readonly o: Opts,
    private readonly sdk: SearchAppSDK,
  ) {
    this.perPage = Math.min(48, Number(o.perPage) || 24);
    el.addEventListener("change", (e) => this.onChange(e));
    el.addEventListener("click", (e) => this.onClick(e));
    el.addEventListener("submit", (e) => this.onSubmit(e));
    window.addEventListener("popstate", () => this.reload());
    // Code khác (section tuỳ biến, docs/developers/examples) đổi filter/sort qua SDK → widget tải lại theo URL.
    sdk.on("filters:change", () => this.reload());
    sdk.on("sort:change", () => this.reload());
    void this.load();
  }

  private queued = false;
  /** Gộp các yêu cầu tải lại trong cùng một tick (apply() vừa set state vừa phát event). */
  private reload() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.el.classList.add("sa-loading");
      void this.load();
    });
  }

  private get isCollection() {
    return this.o.mode === "collection" && Boolean(this.o.collection);
  }

  async load(): Promise<void> {
    const mine = ++this.loading;
    try {
      if (!this.cfg) {
        this.cfg = await this.sdk.getConfig();
        applyCssVars(this.cfg.cssVars);
      }
      const st = this.sdk.state.get();
      const params = {
        ...st,
        sort: st.sort ?? (this.o.defaultSort || undefined),
        perPage: this.perPage,
      };
      const res = this.isCollection
        ? await this.sdk.collection(this.o.collection!, params)
        : await this.sdk.search(params);
      if (mine !== this.loading) return;
      if (res.redirect) {
        location.assign(safeHref(res.redirect));
        return;
      }
      this.last = res;
      this.render(res);
    } catch {
      // Engine/API lỗi: giữ kết quả native do Liquid in sẵn (không ném lỗi ra console).
      this.el.classList.remove("sa-loading");
    }
  }

  private t(key: string, vars: Record<string, string | number> = {}) {
    return fill(this.cfg?.texts[key] ?? key, vars);
  }

  private card(p: Product, i: number, tpl: string) {
    return this.sdk.render(tpl, {
      ...p,
      vendor: this.cfg?.showVendor === false ? "" : p.vendor,
      position: i + 1,

      view_price: this.t("viewPrice"),
      badge_labels: p.badges.map((b) =>
        b === "sale" ? this.t("sale") : b === "sold_out" ? this.t("soldOut") : b,
      ),
    });
  }

  private facet(f: Facet): string {
    const head = `<legend class="sa-facet__title">${esc(f.label)}</legend>`;
    if (f.type === "range") {
      const sel = f.selected ?? {};
      const input = (n: "min" | "max") =>
        `<label>${esc(this.t(n))}<input type="number" name="${n}" inputmode="decimal" min="${f.min}" max="${f.max}" placeholder="${f[n]}" value="${sel[n] ?? ""}"></label>`;
      return (
        `<fieldset class="sa-facet" data-key="${esc(f.key)}">${head}<form class="sa-range" data-key="${esc(f.key)}">` +
        input("min") +
        input("max") +
        `<button type="submit" class="sa-btn">${esc(this.t("apply"))}</button></form></fieldset>`
      );
    }
    const type = f.type === "radio" ? "radio" : "checkbox";
    const values = f.values
      .map((v) => {
        const label = f.type === "toggle" ? this.t("inStock") : (v.label ?? v.value);
        const swatch =
          f.type === "swatch"
            ? `<span class="sa-swatch" style="--sa-swatch:${esc(v.value.toLowerCase())}"></span>`
            : "";
        return `<li><label class="sa-opt"><input type="${type}" name="${esc(f.key)}" value="${esc(v.value)}"${v.selected ? " checked" : ""}>${swatch}<span>${esc(label)}</span>${f.showCount ? ` <span class="sa-count">(${v.count})</span>` : ""}</label></li>`;
      })
      .join("");
    return `<fieldset class="sa-facet" data-key="${esc(f.key)}"${f.collapsed ? ' data-collapsed=""' : ""}>${head}<ul>${values}</ul></fieldset>`;
  }

  private chips(res: SearchResponse): string {
    // Hiểu truy vấn (5.2): báo cho khách + lối tìm đúng cụm đã gõ.
    const o = this.sdk.state.get().original;
    const note = o
      ? `<p class="sa-note">${esc(this.t("interpreted"))} <a href="?q=${encodeURIComponent(o)}&sa_literal=1">${esc(this.t("searchInstead", { q: o }))}</a></p>`
      : "";
    const out: string[] = [];
    const chip = (key: string, label: string, value?: string) =>
      `<button type="button" class="sa-chip" data-remove="${esc(key)}"${value === undefined ? "" : ` data-value="${esc(value)}"`}>${esc(label)} ×</button>`;
    for (const f of res.facets) {
      if (f.type === "range") {
        if (f.selected && (f.selected.min !== undefined || f.selected.max !== undefined))
          out.push(
            chip(f.key, `${f.label}: ${f.selected.min ?? f.min}–${f.selected.max ?? f.max}`),
          );
      } else {
        for (const v of f.values)
          if (v.selected)
            out.push(chip(f.key, f.type === "toggle" ? f.label : (v.label ?? v.value), v.value));
      }
    }
    return (
      note +
      (out.length
        ? `<div class="sa-chips">${out.join("")}<button type="button" class="sa-chip sa-chip--clear" data-clear="">${esc(this.t("clearAll"))}</button></div>`
        : "")
    );
  }

  private pagination(res: SearchResponse): string {
    if (res.pages <= 1) return "";
    const href = (p: number) => {
      const u = new URL(location.href);
      if (p > 1) u.searchParams.set("page", String(p));
      else u.searchParams.delete("page");
      return esc(u.pathname + u.search);
    };
    const parts: string[] = [];
    if (res.page > 1)
      parts.push(
        `<a href="${href(res.page - 1)}" data-page="${res.page - 1}" rel="prev">${esc(this.t("previous"))}</a>`,
      );
    const from = Math.max(1, res.page - 2);
    const to = Math.min(res.pages, res.page + 2);
    for (let p = from; p <= to; p++) {
      parts.push(
        p === res.page
          ? `<span aria-current="page">${p}</span>`
          : `<a href="${href(p)}" data-page="${p}">${p}</a>`,
      );
    }
    if (res.page < res.pages)
      parts.push(
        `<a href="${href(res.page + 1)}" data-page="${res.page + 1}" rel="next">${esc(this.t("next"))}</a>`,
      );
    return `<nav class="sa-pagination" aria-label="Pagination">${parts.join("")}</nav>`;
  }

  render(res: SearchResponse) {
    const tpl = templateFor("product-card", PRODUCT_CARD, this.el, this.cfg?.templates);
    const pos = this.o.filterPosition || "left";
    const sort =
      this.o.showSort === "false" || !res.sort_options.length
        ? ""
        : `<label class="sa-sort">${esc(this.t("sortBy"))} <select name="sort_by">${res.sort_options
            .map(
              (o) =>
                `<option value="${esc(o.key)}"${o.key === res.sort ? " selected" : ""}>${esc(o.label)}</option>`,
            )
            .join("")}</select></label>`;
    const grid = res.products.length
      ? `<ul class="sa-grid" style="--sa-cols:${Number(this.o.columns) || 4}">${res.products.map((p, i) => this.card(p, i, tpl)).join("")}</ul>`
      : this.sdk.render(templateFor("empty", EMPTY, this.el, this.cfg?.templates), {
          title: this.t("noResults", { q: res.query }),
          hint: this.t("noResultsHint"),
        });
    // "none": theme tự dựng filter bằng SDK (docs/developers/examples/horizontal-filters.liquid).
    const filters =
      res.facets.length && pos !== "none"
        ? `<aside class="sa-filters" aria-label="${esc(this.t("filters"))}"${pos === "drawer" ? " hidden" : ""}>${res.facets.map((f) => this.facet(f)).join("")}</aside>`
        : "";
    const drawerBtn =
      filters && pos === "drawer"
        ? `<button type="button" class="sa-btn" data-drawer="" aria-expanded="false">${esc(this.t("filters"))}</button>`
        : "";
    // Lần đầu: nếu grid native (Liquid) đã đúng các sản phẩm theo đúng thứ tự → giữ nguyên DOM đó (ảnh không vẽ lại
    // → không đổi LCP, task 2.14); chỉ thêm filter/toolbar/phân trang quanh nó.
    const native = this.adopted
      ? null
      : this.el.querySelector<HTMLElement>("[data-native-results]");
    const nativeIds = native
      ? Array.from(native.querySelectorAll<HTMLElement>("[data-sa-id]")).map((n) => n.dataset.saId)
      : [];
    const adopt =
      Boolean(native) &&
      nativeIds.length > 0 &&
      nativeIds.join(",") === res.products.map((p) => p.id).join(",");
    this.adopted = true;
    // Giữ chiều cao cũ trong lúc thay nội dung → không giật layout (CLS).
    this.el.style.minHeight = `${this.el.offsetHeight}px`;
    const toolbar = `<p class="sa-total" aria-live="polite">${esc(this.t("results", { n: res.total }))}</p>${drawerBtn}${sort}`;
    const layout = this.el.querySelector<HTMLElement>(".sa-layout");
    if (adopt && layout && native!.closest(".sa-main")) {
      // Khung do Liquid in sẵn: điền toolbar/filter/phân trang tại chỗ, grid native đứng yên.
      layout.querySelector(".sa-toolbar")!.innerHTML = toolbar;
      const aside = layout.querySelector(".sa-filters");
      if (aside) {
        if (filters) aside.outerHTML = filters;
        else aside.remove();
      } else if (filters)
        layout.querySelector(".sa-toolbar")!.insertAdjacentHTML("afterend", filters);
      const main = native!.closest(".sa-main")!;
      main.querySelectorAll(".sa-note, .sa-chips, .sa-pagination").forEach((n) => n.remove());
      native!.insertAdjacentHTML("beforebegin", this.chips(res));
      native!.insertAdjacentHTML("afterend", this.pagination(res));
    } else {
      if (adopt) native!.remove();
      this.el.innerHTML =
        `<div class="sa-layout sa-layout--${esc(pos)}"><div class="sa-toolbar">${toolbar}</div>` +
        `${filters}<div class="sa-main">${this.chips(res)}${adopt ? "<div data-sa-slot></div>" : grid}${this.pagination(res)}</div></div>`;
      if (adopt) this.el.querySelector("[data-sa-slot]")!.replaceWith(native!);
    }

    this.el.classList.remove("sa-loading");
    requestAnimationFrame(() => (this.el.style.minHeight = ""));
  }

  private readFilters(): Filters {
    const out: Filters = {};
    if (!this.last) return out;
    for (const f of this.last.facets) {
      if (f.type === "range") {
        if (f.selected) out[f.key] = f.selected;
        continue;
      }
      const checked = Array.from(
        this.el.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(f.key)}"]:checked`),
      ).map((i) => i.value);
      if (!checked.length) continue;
      out[f.key] = f.type === "toggle" ? checked.includes("true") : checked;
    }
    return out;
  }

  private apply(filters: Filters, extra: { sort?: string; page?: number } = {}) {
    this.sdk.state.set({
      filters,
      page: extra.page ?? 1,
      ...(extra.sort ? { sort: extra.sort } : {}),
    });
    this.reload();
  }

  private onChange(e: Event) {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.name === "sort_by") {
      this.sdk.track("sort", { key: t.value });
      return this.apply(this.readFilters(), { sort: t.value });
    }
    if (t instanceof HTMLInputElement && (t.type === "checkbox" || t.type === "radio")) {
      if (t.checked) this.sdk.track("filter", { key: t.name, value: t.value });
      this.apply(this.readFilters());
    }
  }

  private onSubmit(e: Event) {
    const form = e.target as HTMLFormElement;
    if (!form.classList.contains("sa-range")) return;
    e.preventDefault();
    const data = new FormData(form);
    const num = (k: string) =>
      data.get(k) === "" || data.get(k) === null ? undefined : Number(data.get(k));
    const filters = this.readFilters();
    const range = { min: num("min"), max: num("max") };
    if (range.min === undefined && range.max === undefined) delete filters[form.dataset.key!];
    else filters[form.dataset.key!] = range;
    this.apply(filters);
  }

  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLAnchorElement>("a[data-page]");
    if (a) {
      e.preventDefault();
      this.apply(this.readFilters(), { page: Number(a.dataset.page) });
      this.el.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    const product = t.closest<HTMLAnchorElement>("a[data-sa-product]");
    if (product) {
      this.sdk.track("click", {
        query: this.last?.query,
        productId: product.dataset.saProduct,
        position: Number(product.dataset.saPos),
      });
      return;
    }
    const chip = t.closest<HTMLButtonElement>("button[data-remove], button[data-clear]");
    if (chip) {
      const filters = chip.dataset.clear !== undefined ? {} : this.readFilters();
      const key = chip.dataset.remove;
      if (key) {
        const cur = filters[key];
        if (Array.isArray(cur) && chip.dataset.value) {
          const next = cur.filter((v) => v !== chip.dataset.value);
          if (next.length) filters[key] = next;
          else delete filters[key];
        } else delete filters[key];
      }
      return this.apply(filters);
    }
    const drawer = t.closest<HTMLButtonElement>("button[data-drawer]");
    if (drawer) {
      const aside = this.el.querySelector<HTMLElement>(".sa-filters");
      if (aside) {
        aside.hidden = !aside.hidden;
        drawer.setAttribute("aria-expanded", String(!aside.hidden));
      }
    }
  }
}

if (typeof window !== "undefined") {
  // "results" là bí danh được tài liệu hoá (docs/developers, mục 6.4e) của widget trang kết quả đầy đủ.
  const start = () => {
    for (const type of ["search-page", "results"])
      window.SearchApp?.registerWidget(
        type,
        (el, o, sdk) => void new SearchPage(el, o as Opts, sdk),
      );
  };
  // App embed đặt stub { ready() } trước SDK thật → chỉ coi là sẵn sàng khi có `version`, không thì chờ event.
  if (window.SearchApp?.version) start();
  else document.addEventListener("searchapp:ready", start, { once: true });
}
