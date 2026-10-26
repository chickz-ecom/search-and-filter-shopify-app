// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { Emitter } from "./events";
import { formatMoney, intlMoney } from "./money";
import { readState, writeState } from "./state";
import type { PublicFilter } from "./types";

const filters: PublicFilter[] = [
  {
    id: "availability",
    label: "A",
    type: "toggle",
    source: "availability",
    param: "filter.v.availability",
    collapsed: false,
    showCount: true,
  },
  {
    id: "price",
    label: "P",
    type: "range",
    source: "price",
    param: "filter.v.price",
    collapsed: false,
    showCount: false,
  },
  {
    id: "vendor",
    label: "V",
    type: "checkbox",
    source: "vendor",
    param: "filter.p.vendor",
    collapsed: false,
    showCount: true,
  },
];

describe("formatMoney", () => {
  it("follows the theme money format", () => {
    expect(formatMoney(199900, "USD", "${{amount}}")).toBe("$1,999.00");
    expect(formatMoney(199900, "EUR", "{{amount_with_comma_separator}} €")).toBe("1.999,00 €");
    expect(formatMoney(199000, "VND", "{{amount_no_decimals_with_comma_separator}}₫")).toBe(
      "199.000₫",
    );
    expect(formatMoney(1999, "JPY", "¥{{amount_no_decimals}}")).toBe("¥1,999");
    expect(formatMoney(123456, "CHF", "CHF {{amount_with_apostrophe_separator}}")).toBe(
      "CHF 1'234.56",
    );
    expect(intlMoney(1999, "USD", "en-US")).toBe("$19.99");
  });
});

describe("URL state (native Shopify params)", () => {
  it("round-trips q, filters, sort and page", () => {
    const s = readState(
      "?q=dress&filter.p.vendor=Nike&filter.p.vendor=Adidas&filter.v.price.gte=10&filter.v.price.lte=50&filter.v.availability=1&sort_by=price_asc&page=2&utm=x",
      filters,
    );
    expect(s).toEqual({
      q: "dress",
      sort: "price_asc",
      page: 2,
      filters: { vendor: ["Nike", "Adidas"], price: { min: 10, max: 50 }, availability: true },
    });
    const out = writeState({ ...s, page: 1 }, filters, "?utm=x");
    expect(out).toBe(
      "?utm=x&q=dress&filter.v.availability=1&filter.v.price.gte=10&filter.v.price.lte=50&filter.p.vendor=Nike&filter.p.vendor=Adidas&sort_by=price_asc",
    );
    expect(readState(out, filters)).toEqual({ q: "dress", sort: "price_asc", filters: s.filters });
  });

  it("carries the original query and literal flag (query understanding)", () => {
    const s = readState("?q=dress&sa_orig=red+dress&sa_literal=1", filters);
    expect(s).toMatchObject({ q: "dress", original: "red dress", literal: true });
    expect(
      writeState({ q: "dress", filters: {}, original: "red dress" }, filters, "?sa_literal=1"),
    ).toBe("?q=dress&sa_orig=red+dress");
  });

  it("removes cleared filters", () => {
    expect(writeState({ filters: {} }, filters, "?filter.p.vendor=Nike&q=x")).toBe("");
  });
});

describe("Emitter", () => {
  it("calls listeners and dispatches cancelable DOM events", () => {
    const e = new Emitter();
    const fn = vi.fn();
    const off = e.on("filters:change", fn);
    const dom = vi.fn((ev: Event) => ev.preventDefault());
    document.addEventListener("searchapp:filters-change", dom);
    expect(e.emit("filters:change", { a: 1 }, true)).toBe(false);
    expect(fn).toHaveBeenCalledWith({ a: 1 });
    expect(dom).toHaveBeenCalled();
    off();
    e.emit("filters:change", {});
    expect(fn).toHaveBeenCalledTimes(1);
    document.removeEventListener("searchapp:filters-change", dom);
  });
});
