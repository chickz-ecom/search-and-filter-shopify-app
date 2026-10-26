// Logic pixel thuần (test được). Không lưu customer id/email (D13): chỉ query / collection gần nhất trong phiên + sản phẩm/doanh thu.

export type PixelSettings = { shop: string; apiUrl: string; publicKey: string };

export type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

type Money = { amount: number; currencyCode: string } | null | undefined;

type LineItem = {
  quantity?: number;
  finalLinePrice?: Money;
  variant?: { product?: { id?: string | null } | null } | null;
};

export type PixelEvent =
  | { name: "search_submitted"; data: { searchResult: { query: string } } }
  | { name: "collection_viewed"; data: { collection: { id: string; title?: string } | null } }
  | {
      name: "product_added_to_cart";
      data: { cartLine: { merchandise: { product: { id: string } } } | null };
    }
  | {
      name: "checkout_completed";
      data: { checkout: { totalPrice?: Money; subtotalPrice?: Money; lineItems?: LineItem[] } };
    };

const LAST_QUERY = "sa_last_query";
const LAST_COLLECTION = "sa_last_collection";
const ATTRIBUTION_MS = 30 * 60 * 1000;
const numId = (gid: string | null | undefined) => (gid ? String(gid).split("/").pop() : undefined);
const round = (n: number) => Math.round(n * 100) / 100;

export function createPixelHandlers(
  settings: PixelSettings,
  storage: Storage,
  send: (url: string, body: string) => void,
  shopCurrency: string,
  now = () => Date.now(),
) {
  const url = `${settings.apiUrl.replace(/\/$/, "")}/v1/events?shop=${encodeURIComponent(settings.shop)}&key=${encodeURIComponent(settings.publicKey)}`;

  /** Giá trị đã lưu trong phiên, còn trong cửa sổ 30 phút. */
  async function recent(key: string): Promise<string | null> {
    const raw = await storage.getItem(key).catch(() => null);
    if (!raw) return null;
    try {
      const { q, at } = JSON.parse(raw) as { q: string; at: number };
      return now() - at < ATTRIBUTION_MS ? q : null;
    } catch {
      return null;
    }
  }

  /** Ghi nhận cho lượt search gần nhất; không có thì cho collection vừa xem (7.1). */
  async function attribution(): Promise<{ query: string } | { collectionId: string } | null> {
    const q = await recent(LAST_QUERY);
    if (q) return { query: q };
    const c = await recent(LAST_COLLECTION);
    return c ? { collectionId: c } : null;
  }

  /** Doanh thu quy về currency gốc bằng rate SDK đã lưu (localMajor/baseMajor), không có rate → bỏ doanh thu. */
  async function toShopCurrency(m: Money): Promise<number | undefined> {
    if (!m) return undefined;
    if (m.currencyCode === shopCurrency) return m.amount;
    const rate = await storage.getItem(`sa_rate_${m.currencyCode}`).catch(() => null);
    return rate ? m.amount / Number(rate) : undefined;
  }

  return async function handle(e: PixelEvent) {
    if (e.name === "search_submitted") {
      const q = e.data.searchResult.query?.trim();
      if (q) await storage.setItem(LAST_QUERY, JSON.stringify({ q: q.slice(0, 100), at: now() }));
      return;
    }
    if (e.name === "collection_viewed") {
      const id = numId(e.data.collection?.id);
      if (id) await storage.setItem(LAST_COLLECTION, JSON.stringify({ q: id, at: now() }));
      return;
    }
    const attr = await attribution();
    if (!attr) return; // chỉ ghi nhận hành vi sau một lượt search hoặc xem collection
    if (e.name === "product_added_to_cart") {
      const id = numId(e.data.cartLine?.merchandise.product.id);
      if (!id) return;
      send(url, JSON.stringify({ events: [{ type: "add_to_cart", ...attr, productId: id }] }));
      return;
    }
    if (e.name === "checkout_completed") {
      const { checkout } = e.data;
      const revenue = await toShopCurrency(checkout.subtotalPrice ?? checkout.totalPrice);
      const items: { productId: string; qty: number; revenue?: number }[] = [];
      for (const line of (checkout.lineItems ?? []).slice(0, 100)) {
        const productId = numId(line.variant?.product?.id);
        const qty = Number(line.quantity) || 0;
        if (!productId || qty <= 0) continue;
        const r = await toShopCurrency(line.finalLinePrice);
        items.push({ productId, qty, ...(r !== undefined ? { revenue: round(r) } : {}) });
      }
      send(
        url,
        JSON.stringify({
          events: [
            {
              type: "purchase",
              ...attr,
              ...(revenue !== undefined ? { revenue: round(revenue) } : {}),
              ...(items.length ? { items } : {}),
            },
          ],
        }),
      );
    }
  };
}
