import type { SearchAppSDK, SuggestResponse } from "../../storefront-sdk/src/index";
import { applyCssVars, SUGGEST_ITEM, esc, fill, safeHref, templateFor } from "./templates";

// Instant search (mục 7.1): nạp lười khi focus ô search. Dropdown position:fixed (không đẩy layout → không CLS),
// ARIA combobox + phím mũi tên/Enter/Escape. API lỗi → không làm gì, Enter vẫn submit /search native.

const SELECTOR = 'form[action*="/search"] input[name="q"], input[data-searchapp-instant]';
let seq = 0;

/** CSS của widget nạp lười (app embed không chặn render trên mọi trang — task 2.14). */
export function ensureCss(href?: string) {
  if (!href || document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
}

function attach(input: HTMLInputElement, sdk: SearchAppSDK) {
  if (input.dataset.saInstant) return;
  input.dataset.saInstant = "1";
  ensureCss(sdk.context.cssUrl);

  const id = `sa-ac-${++seq}`;
  const box = document.createElement("div");
  box.id = id;
  box.className = "sa-ac";
  box.setAttribute("role", "listbox");
  box.hidden = true;
  document.body.appendChild(box);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", id);
  input.setAttribute("autocomplete", "off");

  let timer: ReturnType<typeof setTimeout> | undefined;
  let req = 0;
  let active = -1;
  let texts: Record<string, string> = {};
  let templates: Record<string, string> = {};
  void sdk
    .getConfig()
    .then((c) => {
      texts = c.texts;
      templates = c.templates;
      applyCssVars(c.cssVars);
    })
    .catch(() => undefined);

  const options = () => Array.from(box.querySelectorAll<HTMLElement>('[role="option"]'));
  const place = () => {
    const r = input.getBoundingClientRect();
    const w = Math.min(Math.max(r.width, 320), window.innerWidth - 16);
    box.style.cssText = `position:fixed;top:${Math.round(r.bottom + 4)}px;left:${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px;width:${Math.round(w)}px`;
  };
  const show = (on: boolean) => {
    box.hidden = !on;
    input.setAttribute("aria-expanded", String(on));
    if (on) place();
    else {
      active = -1;
      input.removeAttribute("aria-activedescendant");
    }
  };
  const setActive = (i: number) => {
    const opts = options();
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, k) => o.setAttribute("aria-selected", String(k === active)));
    input.setAttribute("aria-activedescendant", opts[active].id);
    opts[active].scrollIntoView?.({ block: "nearest" });
  };

  const render = (q: string, res: SuggestResponse) => {
    const card = templateFor("suggest-item", SUGGEST_ITEM, document, templates);
    let n = 0;
    const opt = (href: string, label: string) =>
      `<a role="option" id="${id}-${n++}" class="sa-ac__item" href="${esc(safeHref(href))}">${esc(label)}</a>`;
    const group = (label: string, body: string) =>
      body
        ? `<div role="group" aria-label="${esc(label)}" class="sa-ac__group"><p class="sa-ac__heading" aria-hidden="true">${esc(label)}</p>${body}</div>`
        : "";
    const searchUrl = sdk.context.searchUrl ?? "/search";
    const html =
      group(
        texts.suggestions ?? "Suggestions",
        res.suggestions.map((s) => opt(`${searchUrl}?q=${encodeURIComponent(s)}`, s)).join(""),
      ) +
      group(
        texts.products ?? "Products",
        res.products
          .map((p, i) => sdk.render(card, { ...p, position: i + 1, option_id: `${id}-${n++}` }))
          .join(""),
      ) +
      group(
        texts.collections ?? "Collections",
        res.collections.map((c) => opt(c.url, c.title)).join(""),
      ) +
      group(
        texts.pages ?? "Pages",
        [...res.pages, ...res.articles].map((c) => opt(c.url, c.title)).join(""),
      );
    if (!html) {
      box.innerHTML = `<p class="sa-ac__empty" role="presentation">${esc(fill(texts.noResults ?? "No results for “{q}”", { q }))}</p>`;
    } else {
      box.innerHTML =
        html +
        (res.total_products > res.products.length
          ? opt(
              `${searchUrl}?q=${encodeURIComponent(q)}`,
              fill(texts.viewAll ?? "View all {n} results", { n: res.total_products }),
            )
          : "");
    }
    show(true);
  };

  const run = () => {
    const q = input.value.trim();
    if (q.length < 2) return show(false);
    const mine = ++req;
    sdk
      .suggest(q, { limit: 6 })
      .then((res) => mine === req && render(q, res))
      .catch(() => show(false)); // lỗi API: giữ hành vi native
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  input.addEventListener(
    "focus",
    () => input.value.trim().length >= 2 && (box.innerHTML ? show(true) : run()),
  );
  input.addEventListener("blur", () => setTimeout(() => show(false), 150));
  input.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Escape") show(false);
    else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      options()[active].click();
    }
  });
  box.addEventListener("mousedown", (e) => e.preventDefault()); // giữ focus để click không bị blur trước
  box.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-sa-product]");
    if (a)
      sdk.track("click", {
        query: input.value.trim(),
        productId: a.dataset.saProduct,
        position: Number(a.dataset.saPos),
      });
  });
  const reposition = () => !box.hidden && requestAnimationFrame(place);
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition, { passive: true });
}

export function initInstant(sdk: SearchAppSDK, root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>(SELECTOR).forEach((i) => attach(i, sdk));
  const focused = document.activeElement as HTMLInputElement | null;
  if (focused?.matches?.(SELECTOR) && focused.value.trim().length >= 2)
    focused.dispatchEvent(new Event("input"));
}

if (typeof window !== "undefined") {
  const start = () => window.SearchApp && initInstant(window.SearchApp);
  if (window.SearchApp) start();
  else document.addEventListener("searchapp:ready", start, { once: true });
}
