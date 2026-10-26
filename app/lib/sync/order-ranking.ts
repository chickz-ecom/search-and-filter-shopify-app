// Xếp hạng bán chạy theo đơn 60 ngày (task 2.15, D17) — phần thuần. Chỉ dùng id, số lượng, doanh thu dòng và ngày;
// không bao giờ hỏi Shopify trường nào về khách hàng (test grep query). Operation đã validate (2026-10):
// docs/shopify-api/admin/orders-bulk-60d.graphql, order-lines.graphql.

export const WINDOW_DAYS = 60;
export type RankMetric = "quantity" | "orders" | "revenue";

/** Bulk lần đầu: đơn trong 60 ngày. Không lọc `test` ở query (cú pháp chưa có trong docs) — bỏ đơn test trong code. */
export const ordersBulkQuery = (since: Date) => `{
  orders(query: "created_at:>='${since.toISOString().replace(/\.\d{3}Z$/, "Z")}'") {
    edges {
      node {
        id
        createdAt
        cancelledAt
        test
        lineItems {
          edges {
            node {
              id
              currentQuantity
              product { id }
              discountedTotalSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }
  }
}`;

export const ORDER_LINES_QUERY = `query OrderLines($id: ID!, $cursor: String) {
  order(id: $id) {
    id
    createdAt
    cancelledAt
    test
    lineItems(first: 250, after: $cursor) {
      nodes {
        currentQuantity
        product { id }
        discountedTotalSet { shopMoney { amount currencyCode } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export type OrderInput = {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  lineItems: {
    currentQuantity: number;
    product: { id: string } | null;
    discountedTotalSet?: { shopMoney: { amount: string } } | null;
  }[];
};
export type OrderLineRow = {
  orderId: string;
  productId: string;
  qty: number;
  revenue: number;
  createdAt: Date;
};

const tail = (gid: string) => gid.split("/").pop()!;

/** Gộp dòng theo sản phẩm. currentQuantity đã trừ hoàn/huỷ/chỉnh sửa; đơn huỷ hoặc đơn test → không tính. */
export function orderToLines(o: OrderInput): OrderLineRow[] {
  if (o.cancelledAt || o.test) return [];
  const by = new Map<string, { qty: number; revenue: number }>();
  for (const li of o.lineItems) {
    if (!li.product || li.currentQuantity <= 0) continue;
    const id = tail(li.product.id);
    const cur = by.get(id) ?? { qty: 0, revenue: 0 };
    cur.qty += li.currentQuantity;
    cur.revenue += Number(li.discountedTotalSet?.shopMoney.amount ?? 0);
    by.set(id, cur);
  }
  return [...by.entries()].map(([productId, v]) => ({
    orderId: tail(o.id),
    productId,
    qty: v.qty,
    revenue: Math.round(v.revenue * 100) / 100,
    createdAt: new Date(o.createdAt),
  }));
}

export type ProductTotals = { productId: string; qty: number; orders: number; revenue: number };

/** Thứ tự sản phẩm (hạng 1..n) theo tiêu chí; hoà → id nhỏ trước (ổn định); không bán được → không xếp hạng. */
export function rankProducts(rows: ProductTotals[], metric: RankMetric): string[] {
  const value = (r: ProductTotals) =>
    metric === "quantity" ? r.qty : metric === "orders" ? r.orders : r.revenue;
  return rows
    .filter((r) => value(r) > 0)
    .sort((a, b) => value(b) - value(a) || Number(a.productId) - Number(b.productId))
    .map((r) => r.productId);
}
