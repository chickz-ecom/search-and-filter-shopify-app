// Logic pixel thuần (test được). Không lưu customer id/email (D13): chỉ query gần nhất trong phiên + sản phẩm/doanh thu.

export type PixelSettings = { shop: string; apiUrl: string; publicKey: string };

export type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

type Money = { amount: number; currencyCode: string } | null | undefined;

export type PixelEvent =
  | { name: "search_submitted"; data: { searchResult: { query: string } } }
  | {
      name: "product_added_to_cart";
      data: { cartLine: { merchandise: { product: { id: string } } } | null };
    }
  | {
      name: "checkout_completed";
      data: { checkout: { totalPrice?: Money; subtotalPrice?: Money } };
    };

const LAST_QUERY = "sa_last_query";
const ATTRIBUTION_MS = 30 * 60 * 1000;

export function createPixelHandlers(
  settings: PixelSettings,
  storage: Storage,
  send: (url: string, body: string) => void,
  shopCurrency: string,
  now = () => Date.now(),
) {
  const url = `${settings.apiUrl.replace(/\/$/, "")}/v1/events?shop=${encodeURIComponent(settings.shop)}&key=${encodeURIComponent(settings.publicKey)}`;

  async function lastQuery(): Promise<string | null> {
    const raw = await storage.getItem(LAST_QUERY).catch(() => null);
    if (!raw) return null;
    try {
      const { q, at } = JSON.parse(raw) as { q: string; at: number };
      return now() - at < ATTRIBUTION_MS ? q : null;
    } catch {
      return null;
    }
  }

  /** Doanh thu quy về currency gốc bằng rate SDK đã lưu (localMajor/baseMajor), không có rate → bỏ doanh thu. */
  async function toShopCurrency(m: Money): Promise<number | undefined> {
    if (!m) return undefined;
    if (m.currencyCode === shopCurrency) return m.amount;
    const keys = [`sa_rate_${m.currencyCode}`];
    for (const k of keys) {
      const all = await storage.getItem(k).catch(() => null);
      if (all) return m.amount / Number(all);
    }
    return undefined;
  }

  return async function handle(e: PixelEvent) {
    if (e.name === "search_submitted") {
      const q = e.data.searchResult.query?.trim();
      if (q) await storage.setItem(LAST_QUERY, JSON.stringify({ q: q.slice(0, 100), at: now() }));
      return;
    }
    const q = await lastQuery();
    if (!q) return; // chỉ ghi nhận hành vi sau một lượt search
    if (e.name === "product_added_to_cart") {
      const id = e.data.cartLine?.merchandise.product.id;
      if (!id) return;
      send(
        url,
        JSON.stringify({
          events: [{ type: "add_to_cart", query: q, productId: String(id).split("/").pop() }],
        }),
      );
      return;
    }
    if (e.name === "checkout_completed") {
      const revenue = await toShopCurrency(
        e.data.checkout.subtotalPrice ?? e.data.checkout.totalPrice,
      );
      send(
        url,
        JSON.stringify({
          events: [
            {
              type: "purchase",
              query: q,
              ...(revenue !== undefined ? { revenue: Math.round(revenue * 100) / 100 } : {}),
            },
          ],
        }),
      );
    }
  };
}
