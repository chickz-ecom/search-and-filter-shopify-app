import { z } from "zod";
import type { BestSellingInfo } from "../../components/SortingView";
import { enqueueSync } from "../queue/queue.server";
import type { Db } from "../shop/shop.server";
import type { GraphqlExecutor } from "../shopify/graphql";
import { disableOrderRanking, enableOrderRanking } from "../sync/order-ranking.server";

// Trang Sorting → "Xếp hạng bán chạy" (task 2.15, D17): chuyển nguồn Storefront ↔ đơn 60 ngày, đổi tiêu chí.

export async function bestSellingInfo(db: Db, shopId: string): Promise<BestSellingInfo> {
  const [s, shop] = await Promise.all([
    db.searchSettings.findUnique({
      where: { shopId },
      select: { bestSellingSource: true, bestSellingMetric: true },
    }),
    db.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { bestSellingComputedAt: true, bestSellingOrders: true },
    }),
  ]);
  return {
    source: (s?.bestSellingSource ?? "storefront") as BestSellingInfo["source"],
    metric: (s?.bestSellingMetric ?? "quantity") as BestSellingInfo["metric"],
    computedAt: shop.bestSellingComputedAt?.toISOString() ?? null,
    orders: shop.bestSellingOrders,
  };
}

export const BestSellingInput = z.object({
  source: z.enum(["storefront", "orders"]),
  metric: z.enum(["quantity", "orders", "revenue"]),
});

type Enqueue = (job: Parameters<typeof enqueueSync>[0], jobId: string) => Promise<unknown>;
const defaultEnqueue: Enqueue = (job, jobId) => enqueueSync(job, { jobId });

export async function changeBestSelling(
  db: Db,
  shopId: string,
  ex: GraphqlExecutor,
  input: unknown,
  deps: { appUrl: string; enqueue?: Enqueue; now?: () => number },
): Promise<
  { ok: true; changed: "enabled" | "disabled" | "metric" | "none" } | { ok: false; error: string }
> {
  const r = BestSellingInput.safeParse(input);
  if (!r.success) return { ok: false, error: "invalid" };
  const enqueue = deps.enqueue ?? defaultEnqueue;
  const stamp = (deps.now ?? Date.now)();
  const cur = await bestSellingInfo(db, shopId);
  if (r.data.source === "storefront") {
    if (cur.source === "storefront") return { ok: true, changed: "none" };
    await disableOrderRanking(db, ex, shopId);
    // Khôi phục hạng từ Storefront ngay (không chờ lượt đêm).
    await enqueue({ type: "best-selling", shopId }, `bs-${shopId}-${stamp}`);
    return { ok: true, changed: "disabled" };
  }
  if (cur.source === "orders") {
    if (cur.metric === r.data.metric) return { ok: true, changed: "none" };
    await db.searchSettings.update({
      where: { shopId },
      data: { bestSellingMetric: r.data.metric },
    });
    await enqueue({ type: "order-ranks", shopId }, `order-ranks-${shopId}-now-${stamp}`);
    return { ok: true, changed: "metric" };
  }
  try {
    await enableOrderRanking(db, ex, shopId, deps.appUrl, r.data.metric);
  } catch (e) {
    // Thường do chưa có quyền read_orders (merchant từ chối) → giữ nguồn Storefront.
    return { ok: false, error: (e as Error).message };
  }
  await enqueue({ type: "orders-initial", shopId }, `orders-initial-${shopId}-${stamp}`);
  return { ok: true, changed: "enabled" };
}
