import { describe, expect, it, vi } from "vitest";
import { createPixelHandlers, type Storage } from "./handlers";

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) };
}

const settings = { shop: "s.myshopify.com", apiUrl: "https://api.example/", publicKey: "pk_1" };

describe("web pixel handlers (2.13)", () => {
  it("attributes add-to-cart and purchases to the last search in the session, anonymously", async () => {
    const send = vi.fn();
    let t = 1_000;
    const h = createPixelHandlers(settings, memoryStorage(), send, "USD", () => t);
    await h({
      name: "product_added_to_cart",
      data: { cartLine: { merchandise: { product: { id: "gid://shopify/Product/1" } } } },
    });
    expect(send).not.toHaveBeenCalled(); // chưa search → không ghi nhận
    await h({ name: "search_submitted", data: { searchResult: { query: " Red Dress " } } });
    await h({
      name: "product_added_to_cart",
      data: { cartLine: { merchandise: { product: { id: "gid://shopify/Product/9" } } } },
    });
    await h({
      name: "checkout_completed",
      data: { checkout: { subtotalPrice: { amount: 49.5, currencyCode: "USD" } } },
    });
    expect(send.mock.calls.map((c) => [c[0], JSON.parse(c[1]).events[0]])).toEqual([
      [
        "https://api.example/v1/events?shop=s.myshopify.com&key=pk_1",
        { type: "add_to_cart", query: "Red Dress", productId: "9" },
      ],
      [
        "https://api.example/v1/events?shop=s.myshopify.com&key=pk_1",
        { type: "purchase", query: "Red Dress", revenue: 49.5 },
      ],
    ]);
    t += 31 * 60 * 1000; // hết cửa sổ 30 phút
    await h({
      name: "product_added_to_cart",
      data: { cartLine: { merchandise: { product: { id: "gid://shopify/Product/2" } } } },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("converts revenue to the shop currency with the SDK's rate, or omits it", async () => {
    const send = vi.fn();
    const h = createPixelHandlers(settings, memoryStorage({ sa_rate_EUR: "0.9" }), send, "USD");
    await h({ name: "search_submitted", data: { searchResult: { query: "tee" } } });
    await h({
      name: "checkout_completed",
      data: { checkout: { totalPrice: { amount: 90, currencyCode: "EUR" } } },
    });
    await h({
      name: "checkout_completed",
      data: { checkout: { totalPrice: { amount: 1000, currencyCode: "JPY" } } },
    });
    const evs = send.mock.calls.map((c) => JSON.parse(c[1]).events[0]);
    expect(evs[0]).toEqual({ type: "purchase", query: "tee", revenue: 100 });
    expect(evs[1]).toEqual({ type: "purchase", query: "tee" });
  });
});
