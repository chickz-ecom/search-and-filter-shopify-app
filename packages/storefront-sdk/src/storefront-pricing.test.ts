// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createPricer, languageCode, median, PRICES_QUERY } from "./storefront-pricing";
import type { SearchAppContext } from "./types";

const ctx: SearchAppContext = {
  shop: "s.myshopify.com",
  publicKey: "pk",
  apiBase: "/apps/search",
  country: "DE",
  language: "de",
  currency: "EUR",
  shopCurrency: "USD",
  moneyFormat: "{{amount}} €",
  locale: "de",
};

const node = (id: number, min: string, max = min, cmp?: string, currency = "EUR") => ({
  id: `gid://shopify/Product/${id}`,
  availableForSale: true,
  priceRange: {
    minVariantPrice: { amount: min, currencyCode: currency },
    maxVariantPrice: { amount: max, currencyCode: currency },
  },
  compareAtPriceRange: { maxVariantPrice: cmp ? { amount: cmp, currencyCode: currency } : null },
});

const products = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    gid: `gid://shopify/Product/${i + 1}`,
    price_min: 1000 * (i + 1),
    price_max: 1000 * (i + 1),
    currency: "USD",
  }));

function storefront(nodes: unknown[]) {
  return vi.fn(async () => new Response(JSON.stringify({ data: { nodes } })));
}

describe("Storefront pricing (D15)", () => {
  it("makes exactly ONE request for a whole page of 48 products and merges by id", async () => {
    const page = products(48);
    // Shopify trả theo thứ tự bất kỳ + null cho sản phẩm không bán ở market.
    const nodes = page
      .map((p, i) => (i === 5 ? null : node(i + 1, String((p.price_min / 100) * 0.9))))
      .reverse();
    const f = storefront(nodes);
    const pricer = createPricer(ctx, { fetch: f as unknown as typeof fetch, storage: null });
    const r = await pricer.localize(page);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://s.myshopify.com/api/2026-10/graphql.json");
    const body = JSON.parse(String(init.body));
    expect(body.query).toBe(PRICES_QUERY);
    expect(body.variables).toEqual({ ids: page.map((p) => p.gid), country: "DE", language: "DE" });
    expect(r.ok).toBe(true);
    expect(r.currency).toBe("EUR");
    expect(r.prices.get("gid://shopify/Product/1")).toEqual({
      min: 900,
      max: 900,
      available: true,
    });
    expect(r.prices.get("gid://shopify/Product/6")).toBeNull(); // không bán ở DE → ẩn
    expect(r.rate).toBeCloseTo(0.9);
    expect(PRICES_QUERY).not.toContain("variants");
  });

  it("caches per gid+country for the session (autocomplete then results: no refetch)", async () => {
    const f = storefront([node(1, "9.00", "9.00", "12.00")]);
    const pricer = createPricer(ctx, { fetch: f as unknown as typeof fetch, storage: null });
    await pricer.localize(products(1));
    const again = await pricer.localize(products(1));
    expect(f).toHaveBeenCalledTimes(1);
    expect(again.prices.get("gid://shopify/Product/1")).toEqual({
      min: 900,
      max: 900,
      compareAtMax: 1200,
      available: true,
    });
  });

  it("times out after 1.5s → ok=false so the UI hides amounts ('View price')", async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const onError = vi.fn();
    const pricer = createPricer(ctx, {
      fetch: f as unknown as typeof fetch,
      storage: null,
      onError,
    });
    const p = pricer.localize(products(2));
    vi.advanceTimersByTime(1600);
    const r = await p;
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    expect(onError).toHaveBeenCalled();
  });

  it("treats GraphQL errors / HTTP errors as failures", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: "MAX_COMPLEXITY_EXCEEDED" }] })),
    );
    expect(
      (
        await createPricer(ctx, { fetch: f as unknown as typeof fetch, storage: null }).localize(
          products(1),
        )
      ).ok,
    ).toBe(false);
    const g = vi.fn(async () => new Response("nope", { status: 500 }));
    expect(
      (
        await createPricer(ctx, { fetch: g as unknown as typeof fetch, storage: null }).localize(
          products(1),
        )
      ).ok,
    ).toBe(false);
  });

  it("computes the rate in major units across zero-decimal currencies (USD → VND)", async () => {
    const vctx = { ...ctx, country: "VN", currency: "VND", language: "vi" };
    const f = storefront([
      node(1, "250000", "250000", undefined, "VND"),
      node(2, "500000", "500000", undefined, "VND"),
    ]);
    const pricer = createPricer(vctx, { fetch: f as unknown as typeof fetch, storage: null });
    const r = await pricer.localize(products(2)); // $10, $20
    expect(r.prices.get("gid://shopify/Product/1")).toMatchObject({ min: 250000 });
    expect(r.rate).toBe(25000); // 250.000 ₫ / $10
    expect(pricer.rate()).toBe(25000);
  });

  it("needs local prices only when the buyer currency differs or the market adjusts prices", () => {
    expect(createPricer({ ...ctx, currency: "USD" }).needsLocalPrice()).toBe(false);
    expect(createPricer({ ...ctx, currency: "USD" }).needsLocalPrice(true)).toBe(true);
    expect(createPricer(ctx).needsLocalPrice()).toBe(true);
  });

  it("maps locales to LanguageCode and computes medians", () => {
    expect(languageCode("pt-BR")).toBe("PT_BR");
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(1);
  });
});
