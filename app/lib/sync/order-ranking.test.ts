import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORDER_LINES_QUERY, ordersBulkQuery, orderToLines, rankProducts } from "./order-ranking";

const order = (over: Record<string, unknown> = {}) => ({
  id: "gid://shopify/Order/1",
  createdAt: "2026-10-20T10:00:00Z",
  cancelledAt: null,
  test: false,
  lineItems: [
    {
      currentQuantity: 2,
      product: { id: "gid://shopify/Product/11" },
      discountedTotalSet: { shopMoney: { amount: "40.00" } },
    },
    {
      currentQuantity: 1,
      product: { id: "gid://shopify/Product/11" },
      discountedTotalSet: { shopMoney: { amount: "18.50" } },
    },
    {
      currentQuantity: 0,
      product: { id: "gid://shopify/Product/12" },
      discountedTotalSet: { shopMoney: { amount: "0.00" } },
    },
    { currentQuantity: 3, product: null, discountedTotalSet: { shopMoney: { amount: "9.00" } } },
  ],
  ...over,
});

describe("order-based best-selling (2.15)", () => {
  it("folds line items per product using currentQuantity (refunds/edits already applied)", () => {
    expect(orderToLines(order())).toEqual([
      {
        orderId: "1",
        productId: "11",
        qty: 3,
        revenue: 58.5,
        createdAt: new Date("2026-10-20T10:00:00Z"),
      },
    ]);
  });

  it("drops cancelled and test orders entirely", () => {
    expect(orderToLines(order({ cancelledAt: "2026-10-21T00:00:00Z" }))).toEqual([]);
    expect(orderToLines(order({ test: true }))).toEqual([]);
  });

  it("ranks by quantity, number of orders or revenue; ties by product id; unsold products are left out", () => {
    const rows = [
      { productId: "1", qty: 5, orders: 1, revenue: 50 },
      { productId: "2", qty: 3, orders: 3, revenue: 300 },
      { productId: "3", qty: 3, orders: 2, revenue: 30 },
      { productId: "4", qty: 0, orders: 0, revenue: 0 },
    ];
    expect(rankProducts(rows, "quantity")).toEqual(["1", "2", "3"]);
    expect(rankProducts(rows, "orders")).toEqual(["2", "3", "1"]);
    expect(rankProducts(rows, "revenue")).toEqual(["2", "1", "3"]);
  });

  it("never asks Shopify for customer data and matches the validated operations", () => {
    for (const q of [ordersBulkQuery(new Date("2026-08-27T00:00:00Z")), ORDER_LINES_QUERY])
      expect(q).not.toMatch(/customer|email|phone|address|billing|shipping|note|name/i);
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(norm(ORDER_LINES_QUERY)).toBe(
      norm(readFileSync("docs/shopify-api/admin/order-lines.graphql", "utf8")),
    );
    expect(ordersBulkQuery(new Date("2026-08-27T00:00:00Z"))).toContain(
      `created_at:>='2026-08-27T00:00:00Z'`,
    );
  });
});
