import type { SearchEngine } from "../search/engine";
import { productAlias } from "../search/names";
import { realClock, type Clock } from "../shopify/graphql";
import { gidToId } from "./mapper";

// best_selling_rank (task 1.12): thứ tự BEST_SELLING của Shopify qua Storefront API — không cần read_orders
// (Protected Customer Data). Gọi từ server bằng private token (`unauthenticated.storefront`, header
// Shopify-Storefront-Private-Token; scope unauthenticated_read_product_listings), chậm và có backoff:
// docs cảnh báo traffic tự động bằng token public/tokenless từ một IP bị giới hạn (HTTP 430).

export const BEST_SELLING_QUERY = `query BestSellingProductIds($cursor: String) {
  products(first: 250, after: $cursor, sortKey: BEST_SELLING) {
    nodes { id }
    pageInfo { hasNextPage endCursor }
  }
}`;

export type StorefrontTransport = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<{ data?: unknown; errors?: unknown; status?: number }>;

/** Adapter cho `unauthenticated.storefront(shop).storefront.graphql`. */
export function storefrontContextTransport(storefront: {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}): StorefrontTransport {
  return async (query, variables) => {
    try {
      const res = await storefront.graphql(query, { variables });
      return (await res.json()) as { data?: unknown; errors?: unknown };
    } catch (err) {
      const status =
        (err as { response?: { code?: number }; status?: number }).response?.code ??
        (err as { status?: number }).status;
      return { errors: String(err), status };
    }
  };
}

type Page = {
  products: {
    nodes: { id: string }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export async function fetchBestSellingOrder(
  transport: StorefrontTransport,
  opts: { maxProducts?: number; pauseMs?: number; clock?: Clock; maxRetries?: number } = {},
): Promise<string[]> {
  const clock = opts.clock ?? realClock;
  const max = opts.maxProducts ?? 300_000;
  const pause = opts.pauseMs ?? 250;
  const ids: string[] = [];
  let cursor: string | null = null;
  while (ids.length < max) {
    let page: Page | null = null;
    for (let attempt = 0; attempt <= (opts.maxRetries ?? 5); attempt++) {
      const r = await transport(BEST_SELLING_QUERY, { cursor });
      if (r.data && !r.errors) {
        page = r.data as Page;
        break;
      }
      // 429/430/5xx hoặc lỗi GraphQL tạm thời → chờ lũy tiến rồi thử lại.
      await clock.sleep(1000 * 2 ** attempt);
    }
    if (!page) throw new Error("Storefront best-selling: retries exhausted");
    ids.push(...page.products.nodes.map((n) => gidToId(n.id)));
    if (!page.products.pageInfo.hasNextPage) break;
    cursor = page.products.pageInfo.endCursor;
    await clock.sleep(pause);
  }
  return ids;
}

/** Chỉ ghi document có rank đổi (đêm bình thường gần như không ghi). */
export async function applyBestSellingRanks(engine: SearchEngine, shopId: string, order: string[]) {
  const rank = new Map(order.map((id, i) => [id, i + 1]));
  const alias = productAlias(shopId);
  const updates: { id: string; best_selling_rank: number | null }[] = [];
  for await (const d of engine.exportDocuments<{ id: string; best_selling_rank?: number }>(alias, [
    "id",
    "best_selling_rank",
  ])) {
    const next = rank.get(d.id) ?? null;
    if ((d.best_selling_rank ?? null) !== next) updates.push({ id: d.id, best_selling_rank: next });
  }
  for (let i = 0; i < updates.length; i += 1000) {
    await engine.updateDocuments(alias, updates.slice(i, i + 1000));
  }
  return { ranked: order.length, updated: updates.length };
}

/** Rank hiện có trong index (giữ qua re-index để không mất sort bán chạy trong lúc chờ lượt đêm). */
export async function currentRanks(
  engine: SearchEngine,
  collection: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for await (const d of engine.exportDocuments<{ id: string; best_selling_rank?: number }>(
    collection,
    ["id", "best_selling_rank"],
    "best_selling_rank:>0",
  )) {
    if (d.best_selling_rank) out.set(d.id, d.best_selling_rank);
  }
  return out;
}
