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
  private rangeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Accordion mở/đóng theo facet (giữ qua các lần render lại). */
  private open = new Map<string, boolean>();
  private sheetOpen = false;
  /** Mobile (< 750px): filter thành nút + bottom sheet. */
  private readonly mq =
    typeof matchMedia === "function" ? matchMedia("(max-width: 749px)") : undefined;

  private readonly perPage: number;

  constructor(
    private readonly el: HTMLElement,
    private readonly o: Opts,
    private readonly sdk: SearchAppSDK,
  ) {
    this.perPage = Math.min(48, Number(o.perPage) || 24);
    el.addEventListener("change", (e) => this.onChange(e));
    el.addEventListener("input", (e) => syncRange(e.target as HTMLInputElement));
    el.addEventListener("click", (e) => this.onClick(e));
    el.addEventListener("submit", (e) => this.onSubmit(e));
    // "toggle" của <details> không nổi bọt → nghe ở pha capture.
    el.addEventListener("toggle", (e) => this.onToggle(e), true);
    el.addEventListener("keydown", (e) => this.onKey(e));
    this.mq?.addEventListener?.("change", () => this.syncSheet());
    // Lọc ngang (top): bấm ra ngoài thì đóng dropdown đang mở.
    document.addEventListener("click", (e) => {
      if (this.o.filterPosition === "top" && !this.sheetMode && !el.contains(e.target as Node))
        el.querySelectorAll<HTMLDetailsElement>("details.sa-facet[open]").forEach(
          (d) => (d.open = false),
        );
    });
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

  /** Filter hiện dạng sheet: mobile, hoặc vị trí "drawer" ở mọi màn hình. */
  private get sheetMode() {
    return this.o.filterPosition === "drawer" || Boolean(this.mq?.matches);
  }

  /** Id collection (từ API hoặc Liquid) — cho analytics theo collection. */
  private get collectionId(): string | undefined {
    return this.last?.collection?.id ?? this.sdk.context.collection?.id ?? undefined;
  }

  /** Ngữ cảnh filter cho analytics: trang search hoặc id collection. */
  private get scope(): string | undefined {
    return this.isCollection ? this.collectionId : "search";
  }

  /** Tổ hợp ≥ 2 giá trị đang áp dụng (Analytics → Filter value combinations). */
  private trackCombo(filters: Filters) {
    const values = Object.entries(filters).flatMap(([k, v]) =>
      Array.isArray(v) ? v.map((x) => `${k}=${x}`) : typeof v === "boolean" ? [`${k}=${v}`] : [],
    );
    if (values.length >= 2) this.sdk.track("filter_combo", { scope: this.scope, values });
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
      const first = !this.last;
      this.last = res;
      this.render(res);
      // Một lượt xem cho mỗi lần mở trang collection (không tính lọc/sắp xếp/phân trang sau đó).
      if (first && this.isCollection && this.collectionId)
        this.sdk.track("collection_view", { collectionId: this.collectionId });
    } catch {
      // Engine/API lỗi: bỏ skeleton, giữ kết quả native do Liquid in sẵn (không ném lỗi ra console).
      this.el.classList.remove("sa-loading", "sa-pending");
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
    const chosen = chosenCount(f);
    let body: string;
    if (f.type === "range") {
      // Thanh trượt 2 đầu (không ô nhập tay); giá trị hiện dưới thanh, thả tay → áp dụng.
      const sel = f.selected ?? {};
      const thumb = (n: "min" | "max") =>
        `<input type="range" name="${n}" min="${f.min}" max="${f.max}" step="1" value="${sel[n] ?? f[n]}" aria-label="${esc(`${f.label} ${this.t(n)}`)}">`;
      body =
        `<form class="sa-range" data-key="${esc(f.key)}" data-min="${f.min}" data-max="${f.max}" data-currency="${esc(f.currency ?? "")}" data-locale="${esc(this.sdk.context.locale)}">` +
        `<div class="sa-slider">${thumb("min")}${thumb("max")}</div>` +
        `<div class="sa-range__values"><output></output><output></output></div></form>`;
    } else {
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
      body = `<ul>${values}</ul>`;
    }
    // Mặc định: desktop mở (trừ facet admin đặt "thu gọn"), sheet mobile và lọc ngang thì đóng; đang có lựa chọn → mở.
    const top = this.o.filterPosition === "top" && !this.sheetMode;
    const open =
      this.open.get(f.key) ?? (!top && (chosen > 0 || (!this.sheetMode && !f.collapsed)));
    return (
      `<details class="sa-facet" data-key="${esc(f.key)}"${open ? " open" : ""}>` +
      `<summary class="sa-facet__title">${esc(f.label)}${chosen ? `<span class="sa-badge-count">${chosen}</span>` : ""}</summary>` +
      `<div class="sa-facet__body" role="group" aria-label="${esc(f.label)}">${body}</div></details>`
    );
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
            chip(
              f.key,
              `${f.label}: ${rangeText(f.selected.min ?? f.min, f.currency, this.sdk.context.locale)}–${rangeText(f.selected.max ?? f.max, f.currency, this.sdk.context.locale)}`,
            ),
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
    // Cùng một khối filter: desktop là cột (sticky) / hàng dropdown; mobile/"drawer" là sheet có đầu + chân.
    const active = res.facets.reduce((n, f) => n + chosenCount(f), 0);
    const filters =
      res.facets.length && pos !== "none"
        ? `<aside class="sa-filters" aria-label="${esc(this.t("filters"))}"><div class="sa-filters__panel">` +
          `<div class="sa-filters__head"><p class="sa-filters__title">${esc(this.t("filters"))}</p><button type="button" class="sa-close" data-sheet-close="" aria-label="${esc(this.t("close"))}">${ICON_CLOSE}</button></div>` +
          `<div class="sa-filters__body">${res.facets.map((f) => this.facet(f)).join("")}</div>` +
          `<div class="sa-filters__foot"><button type="button" class="sa-btn" data-sheet-close="">${esc(this.t("showResults", { n: res.total }))}</button>` +
          `<button type="button" class="sa-btn sa-btn--secondary" data-clear=""${active ? "" : " disabled"}>${esc(this.t("resetFilters"))}</button></div>` +
          `</div></aside>`
        : "";
    const drawerBtn = filters
      ? `<button type="button" class="sa-btn sa-btn--secondary sa-filters-btn" data-sheet-open="" aria-haspopup="dialog" aria-expanded="false">${ICON_FILTER}${esc(this.t("filters"))}${active ? `<span class="sa-badge-count">${active}</span>` : ""}</button>`
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
    // Render thay DOM → nhớ phần tử đang focus (thanh trượt/checkbox) để trả focus lại cho người dùng bàn phím.
    const a = document.activeElement as HTMLInputElement | null;
    const scope = a?.closest<HTMLElement>(".sa-range");
    const refocus =
      a && a.name && this.el.contains(a)
        ? (scope ? `.sa-range[data-key="${CSS.escape(scope.dataset.key!)}"] ` : "") +
          `[name="${CSS.escape(a.name)}"]` +
          (a.type === "checkbox" || a.type === "radio" ? `[value="${CSS.escape(a.value)}"]` : "")
        : "";
    const scrolls = [".sa-filters", ".sa-filters__body"].map(
      (sel) => this.el.querySelector(sel)?.scrollTop ?? 0,
    );
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

    this.el.querySelectorAll<HTMLFormElement>(".sa-range").forEach(paintRange);
    [".sa-filters", ".sa-filters__body"].forEach((sel, i) => {
      const n = this.el.querySelector(sel);
      if (n) n.scrollTop = scrolls[i];
    });
    this.syncSheet();
    if (refocus) this.el.querySelector<HTMLElement>(refocus)?.focus();
    // Cột filter sticky: chừa chỗ cho header dính của theme (theme có thể tự đặt --sa-sticky-top).
    if (!getComputedStyle(this.el).getPropertyValue("--sa-sticky-top").trim())
      this.el.style.setProperty("--sa-sticky-top", `${headerOffset() + 16}px`);
    this.el.classList.remove("sa-loading", "sa-pending");
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
    const range = t.closest<HTMLFormElement>(".sa-range");
    if (range) {
      // Bàn phím bắn change mỗi lần nhấn mũi tên → gộp các lần nhấn liền nhau thành một lần tải.
      clearTimeout(this.rangeTimer);
      this.rangeTimer = setTimeout(() => range.requestSubmit(), 300);
      return;
    }
    if (t instanceof HTMLInputElement && (t.type === "checkbox" || t.type === "radio")) {
      if (t.checked) this.sdk.track("filter", { key: t.name, value: t.value, scope: this.scope });
      const filters = this.readFilters();
      this.trackCombo(filters);
      this.apply(filters);
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
    // Trùng biên của facet = không lọc phía đó (kéo về hết cỡ là bỏ filter).
    const lo = num("min");
    const hi = num("max");
    const range = {
      min: lo !== undefined && lo > Number(form.dataset.min) ? lo : undefined,
      max: hi !== undefined && hi < Number(form.dataset.max) ? hi : undefined,
    };
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
        source: this.isCollection ? "collection" : "search",
        collectionId: this.collectionId,
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
    if (t.closest("[data-sheet-open]")) return this.setSheet(true);
    // Nút đóng, "Xem N sản phẩm" (kết quả đã cập nhật trực tiếp) hoặc bấm vào nền mờ ngoài sheet.
    if (t.closest("[data-sheet-close]") || (this.sheetOpen && t.classList.contains("sa-filters")))
      this.setSheet(false);
  }

  private onToggle(e: Event) {
    const d = e.target as HTMLDetailsElement;
    if (!d.matches?.("details.sa-facet")) return;
    this.open.set(d.dataset.key!, d.open);
    // Lọc ngang: mỗi lúc chỉ một dropdown mở.
    if (d.open && this.o.filterPosition === "top" && !this.sheetMode)
      this.el.querySelectorAll<HTMLDetailsElement>("details.sa-facet[open]").forEach((x) => {
        if (x !== d) x.open = false;
      });
  }

  private setSheet(open: boolean) {
    this.sheetOpen = open;
    this.syncSheet();
    this.el.querySelector<HTMLElement>(open ? "[data-sheet-close]" : "[data-sheet-open]")?.focus();
  }

  /** Áp trạng thái sheet lên DOM hiện tại (gọi sau mỗi render và khi đổi cỡ màn hình). */
  private syncSheet() {
    const sheet = this.sheetMode;
    if (!sheet) this.sheetOpen = false;
    const open = this.sheetOpen;
    this.el.classList.toggle("sa-sheet", sheet);
    this.el.classList.toggle("sa-sheet-open", open);
    document.documentElement.classList.toggle("sa-lock", open);
    this.el.querySelector("[data-sheet-open]")?.setAttribute("aria-expanded", String(open));
    const panel = this.el.querySelector<HTMLElement>(".sa-filters__panel");
    if (!panel) return;
    if (open) {
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", this.t("filters"));
    } else ["role", "aria-modal", "aria-label"].forEach((a) => panel.removeAttribute(a));
  }

  /** Sheet đang mở: Esc đóng, Tab chạy vòng trong sheet. */
  private onKey(e: KeyboardEvent) {
    if (!this.sheetOpen) return;
    if (e.key === "Escape") return this.setSheet(false);
    if (e.key !== "Tab") return;
    const items = Array.from(
      this.el.querySelectorAll<HTMLElement>(
        ".sa-filters__panel :is(button, summary, input, select, a[href]):not([disabled])",
      ),
    ).filter((x) => x.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}

const ICON_CLOSE =
  '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_FILTER =
  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** Số lựa chọn đang áp dụng của một facet (badge trên tiêu đề accordion + nút Filters). */
function chosenCount(f: Facet): number {
  if (f.type === "range")
    return f.selected && (f.selected.min !== undefined || f.selected.max !== undefined) ? 1 : 0;
  return f.values.filter((v) => v.selected).length;
}

/** Chiều cao header dính/cố định của theme (Dawn sticky-header, Horizon header-component, …). */
function headerOffset(): number {
  for (const h of document.querySelectorAll<HTMLElement>(
    "sticky-header, header-component, .shopify-section-group-header-group, [id^='shopify-section'][id*='header']",
  )) {
    const p = getComputedStyle(h).position;
    if (p === "sticky" || p === "fixed") return Math.round(h.getBoundingClientRect().height);
  }
  return 0;
}

/** Vị trí 2 đầu thanh trượt → biến CSS --lo/--hi (đoạn tô màu giữa 2 đầu). */
function paintRange(form: HTMLFormElement) {
  const [lo, hi] = form.querySelectorAll<HTMLInputElement>("input[type=range]");
  const out = form.querySelectorAll("output");
  const { min: lowest, max: highest, currency, locale } = form.dataset;
  [lo, hi].forEach((i, k) => {
    const pct =
      ((Number(i.value) - Number(lowest)) / (Number(highest) - Number(lowest) || 1)) * 100;
    form.style.setProperty(k ? "--hi" : "--lo", `${pct}%`);
    const text = rangeText(Number(i.value), currency, locale);
    out[k].textContent = text;
    i.setAttribute("aria-valuetext", text);
  });
  // 2 đầu chồng nhau ở mép phải: đưa đầu "min" lên trên, không thì không kéo ra được.
  lo.style.zIndex = Number(lo.value) >= Number(highest) ? "1" : "";
}

/** Kéo: 2 đầu không vượt qua nhau, nhãn giá trị đi theo. */
function syncRange(t: HTMLInputElement) {
  const form = t.closest<HTMLFormElement>(".sa-range");
  if (!form) return;
  const [lo, hi] = form.querySelectorAll<HTMLInputElement>("input[type=range]");
  if (Number(lo.value) > Number(hi.value)) t.value = (t === lo ? hi : lo).value;
  paintRange(form);
}

/** Nhãn khoảng giá ("$19"): tiền tệ của facet, không phần lẻ; range không phải tiền → số trơn. */
function rangeText(v: number, currency?: string, locale?: string): string {
  if (!currency) return String(v);
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} ${currency}`;
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
