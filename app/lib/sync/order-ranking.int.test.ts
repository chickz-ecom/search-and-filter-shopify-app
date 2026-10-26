import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp, typesenseUp } from "../../../test/services";
import { changeBestSelling } from "../admin/best-selling.server";
import { buildProductSchema } from "../search/index-schema";
import { productAlias, productCollection } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import type { GraphqlExecutor } from "../shopify/graphql";
import { webhookActions } from "../webhooks/actions";
import type { BulkRunner } from "./bulk-runner";
import { orderToLines } from "./order-ranking";
import { loadInitialOrders, refreshOrderRanks, replaceOrderLines } from "./order-ranking.server";

// Task 2.15 DoD với Postgres + Typesense thật; Shopify giả lập (bulk JSONL nhóm theo đơn, GraphQL executor).
const up = (await postgresUp()) && (await typesenseUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});
const NOW = new Date("2026-10-26T12:00:00Z");
const DAY = 24 * 3600_000;
const P = 20; // sản phẩm 1..20

// 1.000 đơn tất định: mỗi đơn 1–3 dòng; cứ 10 đơn có 1 đơn huỷ, 1 đơn test, 1 đơn hoàn một phần (currentQuantity giảm);
// 50 đơn ngoài cửa sổ 60 ngày (không được tính).
function fixtureOrders() {
  const orders: {
    id: string;
    createdAt: string;
    cancelledAt: string | null;
    test: boolean;
    lines: { p: number; q: number; amt: number }[];
  }[] = [];
  for (let i = 1; i <= 1000; i++) {
    const age = i <= 50 ? 61 + (i % 5) : i % 59;
    const lines = Array.from({ length: 1 + (i % 3) }, (_, k) => {
      const p = 1 + ((i * 7 + k * 3) % P);
      const ordered = 1 + ((i + k) % 4);
      return { p, q: i % 10 === 3 ? Math.max(0, ordered - 1) : ordered, amt: p * 10 * ordered };
    });
    orders.push({
      id: `gid://shopify/Order/${i}`,
      createdAt: new Date(NOW.getTime() - age * DAY).toISOString(),
      cancelledAt: i % 10 === 1 ? NOW.toISOString() : null,
      test: i % 10 === 2,
      lines,
    });
  }
  return orders;
}

/** Hạng kỳ vọng tính độc lập (không dùng code dưới test). */
function expectedRanking(metric: "quantity" | "orders" | "revenue") {
  const since = NOW.getTime() - 60 * DAY;
  const tot = new Map<number, { qty: number; orders: Set<string>; rev: number }>();
  for (const o of fixtureOrders()) {
    if (o.cancelledAt || o.test || Date.parse(o.createdAt) < since) continue;
    for (const l of o.lines) {
      if (l.q <= 0) continue;
      const t = tot.get(l.p) ?? { qty: 0, orders: new Set(), rev: 0 };
      t.qty += l.q;
      t.orders.add(o.id);
      t.rev += l.amt;
      tot.set(l.p, t);
    }
  }
  const v = (t: { qty: number; orders: Set<string>; rev: number }) =>
    metric === "quantity" ? t.qty : metric === "orders" ? t.orders.size : t.rev;
  return [...tot.entries()]
    .sort((a, b) => v(b[1]) - v(a[1]) || a[0] - b[0])
    .map(([p]) => String(p));
}

const doc = (id: string): ProductDoc => ({
  id,
  gid: `gid://shopify/Product/${id}`,
  handle: `p-${id}`,
  title: `P${id}`,
  title_sort: `P${id}`,
  vendor: "",
  product_type: "",
  tags: [],
  collections: [],
  collection_handles: [],
  collection_titles: [],
  description_text: "",
  skus: [],
  barcodes: [],
  variant_titles: [],
  option_values: [],
  price_min: 1000,
  price_max: 1000,
  discount_pct: 0,
  on_sale: false,
  available: true,
  inventory_total: 1,
  created_at: 1,
  published_at: 1,
  updated_at: 1,
  variants_json: "[]",
});

describe("order webhooks map to order jobs", () => {
  it("only extracts the order id", () => {
    const payload = {
      id: 42,
      admin_graphql_api_id: "gid://shopify/Order/42",
      email: "x@y.z",
      customer: { first_name: "A" },
    };
    for (const t of ["orders/create", "orders/updated", "orders/cancelled"])
      expect(webhookActions(t, payload)).toEqual([
        { kind: "order", orderGid: "gid://shopify/Order/42" },
      ]);
  });
});

describe.skipIf(!up)("best-selling from orders of the last 60 days (2.15)", () => {
  const domain = `ord-${Date.now()}.myshopify.com`;
  let shopId: string;
  const ranks = async () => {
    const out: [string, number][] = [];
    for await (const d of engine.exportDocuments<{ id: string; best_selling_rank?: number }>(
      productAlias(shopId),
      ["id", "best_selling_rank"],
    ))
      if (d.best_selling_rank) out.push([d.id, d.best_selling_rank]);
    return out.sort((a, b) => a[1] - b[1]).map(([id]) => id);
  };

  beforeAll(async () => {
    shopId = (await ensureShop(testDb(), domain)).shop.id;
    const name = productCollection(shopId, 1);
    await engine.createCollection(buildProductSchema({ name, locales: [], metafields: [] }));
    await engine.upsertAlias(productAlias(shopId), name);
    await engine.importDocuments(
      name,
      Array.from({ length: P + 5 }, (_, i) => doc(String(i + 1))),
    );
  });
  afterAll(async () => {
    await engine.deleteAlias(productAlias(shopId)).catch(() => undefined);
    await engine.dropCollection(productCollection(shopId, 1)).catch(() => undefined);
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("imports 1,000 orders (cancelled, test, partial refunds, out-of-window) and ranks correctly", async () => {
    const runner = {
      runOne: async (spec: {
        onRow: (r: Record<string, unknown>) => Promise<void> | void;
        groupObjects?: boolean;
        query: string;
      }) => {
        expect(spec.groupObjects).toBe(true);
        expect(spec.query).toContain("created_at:>='2026-08-27T12:00:00Z'");
        for (const o of fixtureOrders()) {
          await spec.onRow({
            id: o.id,
            createdAt: o.createdAt,
            cancelledAt: o.cancelledAt,
            test: o.test,
          });
          for (const [k, l] of o.lines.entries())
            await spec.onRow({
              id: `gid://shopify/LineItem/${o.id.split("/").pop()}${k}`,
              __parentId: o.id,
              currentQuantity: l.q,
              product: { id: `gid://shopify/Product/${l.p}` },
              discountedTotalSet: { shopMoney: { amount: String(l.amt), currencyCode: "USD" } },
            });
        }
        return {} as never;
      },
    };
    await loadInitialOrders(testDb(), runner as unknown as Pick<BulkRunner, "runOne">, shopId, NOW);
    for (const metric of ["quantity", "orders", "revenue"] as const) {
      const r = await refreshOrderRanks(testDb(), engine, shopId, metric, NOW);
      expect(await ranks(), metric).toEqual(expectedRanking(metric));
      expect(r.orders).toBeGreaterThan(500);
    }
    // Sản phẩm 21–25 không bán → không có hạng (missing last khi sort).
    expect((await ranks()).some((id) => Number(id) > P)).toBe(false);
  });

  it("a new order moves a product up; cancelling it moves it back", async () => {
    await refreshOrderRanks(testDb(), engine, shopId, "quantity", NOW);
    const before = await ranks();
    const last = before[before.length - 1];
    const big = {
      id: "gid://shopify/Order/5000",
      createdAt: NOW.toISOString(),
      cancelledAt: null,
      test: false,
      lineItems: [
        {
          currentQuantity: 10_000,
          product: { id: `gid://shopify/Product/${last}` },
          discountedTotalSet: { shopMoney: { amount: "1" } },
        },
      ],
    };
    await replaceOrderLines(testDb(), shopId, "5000", orderToLines(big));
    await refreshOrderRanks(testDb(), engine, shopId, "quantity", NOW);
    expect((await ranks())[0]).toBe(last);
    await replaceOrderLines(
      testDb(),
      shopId,
      "5000",
      orderToLines({ ...big, cancelledAt: NOW.toISOString() }),
    );
    await refreshOrderRanks(testDb(), engine, shopId, "quantity", NOW);
    expect(await ranks()).toEqual(before);
  });

  it("enabling registers order webhooks; switching back deletes order data and restores Shopify's ranking", async () => {
    const calls: { q: string; v?: Record<string, unknown> }[] = [];
    let subs: { id: string; topic: string; uri: string }[] = [];
    const ex = {
      query: async (q: string, v?: Record<string, unknown>) => {
        calls.push({ q, v });
        if (q.includes("webhookSubscriptions(")) return { webhookSubscriptions: { nodes: subs } };
        if (q.includes("webhookSubscriptionCreate")) {
          subs = [...subs, { id: `w${subs.length}`, topic: String(v!.topic), uri: String(v!.uri) }];
          return { webhookSubscriptionCreate: { userErrors: [] } };
        }
        if (q.includes("webhookSubscriptionDelete")) {
          subs = subs.filter((s) => s.id !== v!.id);
          return { webhookSubscriptionDelete: { userErrors: [] } };
        }
        throw new Error("unexpected query");
      },
    } as unknown as GraphqlExecutor;
    const enqueue = vi.fn(async () => undefined);
    await testDb().searchSettings.update({
      where: { shopId },
      data: { bestSellingSource: "storefront" },
    });
    expect(
      await changeBestSelling(
        testDb(),
        shopId,
        ex,
        { source: "orders", metric: "revenue" },
        { appUrl: "https://app.example", enqueue },
      ),
    ).toEqual({ ok: true, changed: "enabled" });
    expect(subs.map((s) => [s.topic, s.uri])).toEqual(
      ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_CANCELLED"].map((t) => [
        t,
        "https://app.example/webhooks/orders",
      ]),
    );
    expect(enqueue).toHaveBeenCalledWith(
      { type: "orders-initial", shopId },
      expect.stringContaining("orders-initial"),
    );
    expect(await testDb().orderLine.count({ where: { shopId } })).toBeGreaterThan(0);

    expect(
      await changeBestSelling(
        testDb(),
        shopId,
        ex,
        { source: "storefront", metric: "revenue" },
        { appUrl: "https://app.example", enqueue },
      ),
    ).toEqual({ ok: true, changed: "disabled" });
    expect(subs).toEqual([]);
    expect(await testDb().orderLine.count({ where: { shopId } })).toBe(0);
    expect(
      (await testDb().searchSettings.findUniqueOrThrow({ where: { shopId } })).bestSellingSource,
    ).toBe("storefront");
    expect(enqueue).toHaveBeenLastCalledWith(
      { type: "best-selling", shopId },
      expect.stringContaining("bs-"),
    );
  });

  it("a refused permission keeps Shopify's ranking", async () => {
    const ex = {
      query: async () => {
        throw new Error("Access denied for webhookSubscriptions");
      },
    } as unknown as GraphqlExecutor;
    const r = await changeBestSelling(
      testDb(),
      shopId,
      ex,
      { source: "orders", metric: "quantity" },
      { appUrl: "https://app.example", enqueue: vi.fn() },
    );
    expect(r.ok).toBe(false);
    expect(
      (await testDb().searchSettings.findUniqueOrThrow({ where: { shopId } })).bestSellingSource,
    ).toBe("storefront");
  });
});
