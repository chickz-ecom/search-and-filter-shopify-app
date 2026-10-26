import type { SearchEngine } from "../search/engine";
import type { Db } from "../shop/shop.server";
import type { GraphqlExecutor } from "../shopify/graphql";
import { applyBestSellingRanks } from "./best-selling.server";
import type { BulkRunner } from "./bulk-runner";
import {
  ORDER_LINES_QUERY,
  orderToLines,
  ordersBulkQuery,
  rankProducts,
  WINDOW_DAYS,
  type OrderInput,
  type OrderLineRow,
  type RankMetric,
} from "./order-ranking";

// Xếp hạng bán chạy theo đơn 60 ngày (task 2.15, D17): nạp lần đầu bằng bulk, cập nhật theo webhook đơn hàng,
// tính hạng ≤ 15 phút, chỉ ghi best_selling_rank cho sản phẩm đổi hạng. Webhook đơn hàng đăng ký theo shop
// (GraphQL) sau khi merchant cấp optional scope read_orders — TOML chỉ khai được topic của scope bắt buộc.

const DAY = 24 * 3600_000;
export const ORDER_WEBHOOK_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
] as const;
export const ORDER_WEBHOOK_PATH = "/webhooks/orders";

/** Ghi lại toàn bộ dòng của một đơn (idempotent: webhook đến nhiều lần / không theo thứ tự đều ra cùng kết quả). */
export async function replaceOrderLines(
  db: Db,
  shopId: string,
  orderId: string,
  lines: OrderLineRow[],
) {
  await db.$transaction([
    db.orderLine.deleteMany({ where: { shopId, orderId } }),
    ...(lines.length
      ? [
          db.orderLine.createMany({
            data: lines.map((l) => ({ ...l, shopId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

/** Lấy đơn + dòng (phân trang dòng) cho webhook. Đơn không còn (xoá) → null. */
export async function fetchOrder(
  ex: GraphqlExecutor,
  orderGid: string,
): Promise<OrderInput | null> {
  type R = {
    order:
      | (Omit<OrderInput, "lineItems"> & {
          lineItems: {
            nodes: OrderInput["lineItems"];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        })
      | null;
  };
  let cursor: string | null = null;
  let out = null as OrderInput | null;
  do {
    const d: R = await ex.query<R>(ORDER_LINES_QUERY, { id: orderGid, cursor });
    if (!d.order) return out;
    const { lineItems, ...head } = d.order;
    out = out
      ? { ...out, lineItems: [...out.lineItems, ...lineItems.nodes] }
      : { ...head, lineItems: lineItems.nodes };
    cursor = lineItems.pageInfo.hasNextPage ? lineItems.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

/** Nạp lần đầu: bulk đơn 60 ngày (groupObjects: dòng theo ngay sau đơn của nó) → thay toàn bộ OrderLine của shop. */
export async function loadInitialOrders(
  db: Db,
  runner: Pick<BulkRunner, "runOne">,
  shopId: string,
  now = new Date(),
): Promise<{ orders: number }> {
  await db.orderLine.deleteMany({ where: { shopId } });
  let current = null as OrderInput | null;
  let orders = 0;
  let batch: OrderLineRow[] = [];
  const flushOrder = async () => {
    if (!current) return;
    const lines = orderToLines(current);
    if (lines.length) orders++;
    batch.push(...lines);
    current = null;
    if (batch.length >= 1000) {
      await db.orderLine.createMany({
        data: batch.map((l) => ({ ...l, shopId })),
        skipDuplicates: true,
      });
      batch = [];
    }
  };
  type Row = { id: string; __parentId?: string } & Partial<OrderInput> &
    Partial<OrderInput["lineItems"][number]>;
  await runner.runOne<Row>({
    name: "orders-60d",
    query: ordersBulkQuery(new Date(now.getTime() - WINDOW_DAYS * DAY)),
    groupObjects: true,
    onRow: async (r) => {
      if (!r.__parentId) {
        await flushOrder();
        current = {
          id: r.id,
          createdAt: r.createdAt!,
          cancelledAt: r.cancelledAt ?? null,
          test: Boolean(r.test),
          lineItems: [],
        };
      } else if (current && r.__parentId === current.id) {
        current.lineItems.push({
          currentQuantity: r.currentQuantity ?? 0,
          product: r.product ?? null,
          discountedTotalSet: r.discountedTotalSet ?? null,
        });
      }
    },
  });
  await flushOrder();
  if (batch.length)
    await db.orderLine.createMany({
      data: batch.map((l) => ({ ...l, shopId })),
      skipDuplicates: true,
    });
  return { orders };
}

/** Tính hạng theo cửa sổ 60 ngày và ghi vào index (chỉ sản phẩm đổi hạng). */
export async function refreshOrderRanks(
  db: Db,
  engine: SearchEngine,
  shopId: string,
  metric: RankMetric,
  now = new Date(),
) {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const [groups, orderCount] = await Promise.all([
    db.orderLine.groupBy({
      by: ["productId"],
      where: { shopId, createdAt: { gte: since } },
      _sum: { qty: true, revenue: true },
      _count: { orderId: true },
    }),
    db.orderLine.findMany({
      where: { shopId, createdAt: { gte: since } },
      distinct: ["orderId"],
      select: { orderId: true },
    }),
  ]);
  const order = rankProducts(
    groups.map((g) => ({
      productId: g.productId,
      qty: g._sum.qty ?? 0,
      orders: g._count.orderId,
      revenue: Number(g._sum.revenue ?? 0),
    })),
    metric,
  );
  const r = await applyBestSellingRanks(engine, shopId, order);
  await db.shop.update({
    where: { id: shopId },
    data: { bestSellingComputedAt: now, bestSellingOrders: orderCount.length },
  });
  return { ...r, orders: orderCount.length };
}

/** Job đêm: bỏ dòng ngoài cửa sổ 60 ngày (chính sách lưu trữ). */
export async function pruneOrderLines(db: Db, now = new Date()) {
  const r = await db.orderLine.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - WINDOW_DAYS * DAY) } },
  });
  return { deleted: r.count };
}

const WEBHOOK_CREATE = `mutation OrderWebhookCreate($topic: WebhookSubscriptionTopic!, $uri: String!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;
const WEBHOOK_LIST = `query OrderWebhooks {
  webhookSubscriptions(first: 20, topics: [ORDERS_CREATE, ORDERS_UPDATED, ORDERS_CANCELLED]) {
    nodes { id topic uri }
  }
}`;
const WEBHOOK_DELETE = `mutation OrderWebhookDelete($id: ID!) {
  webhookSubscriptionDelete(id: $id) {
    deletedWebhookSubscriptionId
    userErrors { field message }
  }
}`;

type Sub = { id: string; topic: string; uri: string };

/** Bật nguồn "orders": đăng ký webhook đơn hàng (idempotent) rồi caller xếp job nạp lần đầu. */
export async function enableOrderRanking(
  db: Db,
  ex: GraphqlExecutor,
  shopId: string,
  appUrl: string,
  metric: RankMetric,
) {
  const uri = new URL(ORDER_WEBHOOK_PATH, appUrl).toString();
  const existing = (await ex.query<{ webhookSubscriptions: { nodes: Sub[] } }>(WEBHOOK_LIST))
    .webhookSubscriptions.nodes;
  for (const topic of ORDER_WEBHOOK_TOPICS) {
    if (existing.some((s) => s.topic === topic && s.uri === uri)) continue;
    const r = await ex.query<{ webhookSubscriptionCreate: { userErrors: { message: string }[] } }>(
      WEBHOOK_CREATE,
      {
        topic,
        uri,
      },
    );
    const err = r.webhookSubscriptionCreate.userErrors[0];
    if (err) throw new Error(`webhookSubscriptionCreate ${topic}: ${err.message}`);
  }
  await db.searchSettings.update({
    where: { shopId },
    data: { bestSellingSource: "orders", bestSellingMetric: metric },
  });
}

/** Tắt: gỡ webhook, xoá toàn bộ OrderLine, quay về nguồn Shopify (caller xếp lại job best-selling Storefront). */
export async function disableOrderRanking(db: Db, ex: GraphqlExecutor | null, shopId: string) {
  if (ex) {
    const subs = (
      await ex.query<{ webhookSubscriptions: { nodes: Sub[] } }>(WEBHOOK_LIST).catch(() => null)
    )?.webhookSubscriptions.nodes;
    for (const s of subs ?? [])
      if (s.uri.endsWith(ORDER_WEBHOOK_PATH))
        await ex.query(WEBHOOK_DELETE, { id: s.id }).catch(() => undefined);
  }
  await db.orderLine.deleteMany({ where: { shopId } });
  await db.searchSettings.update({ where: { shopId }, data: { bestSellingSource: "storefront" } });
  await db.shop.update({
    where: { id: shopId },
    data: { bestSellingComputedAt: null, bestSellingOrders: 0 },
  });
}
