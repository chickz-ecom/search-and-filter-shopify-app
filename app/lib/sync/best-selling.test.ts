import { describe, expect, it, vi } from "vitest";
import { instantClock } from "../../../test/fakes/fake-shopify";
import { fetchBestSellingOrder, storefrontContextTransport } from "./best-selling.server";

describe("best-selling order (1.12)", () => {
  it("paginates the Storefront BEST_SELLING order with a pause between pages", async () => {
    const pages = [
      {
        products: {
          nodes: [{ id: "gid://shopify/Product/3" }, { id: "gid://shopify/Product/1" }],
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      },
      {
        products: {
          nodes: [{ id: "gid://shopify/Product/2" }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ];
    const transport = vi.fn(async (_q: string, v: Record<string, unknown>) => ({
      data: v.cursor ? pages[1] : pages[0],
    }));
    const clock = instantClock();
    const sleep = vi.spyOn(clock, "sleep");
    expect(await fetchBestSellingOrder(transport, { clock })).toEqual(["3", "1", "2"]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("backs off on throttling (430/429) and retries", async () => {
    let n = 0;
    const transport = vi.fn(async () =>
      n++ < 2
        ? { errors: "Throttled", status: 430 }
        : {
            data: {
              products: {
                nodes: [{ id: "gid://shopify/Product/9" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
    );
    const clock = instantClock();
    const sleep = vi.spyOn(clock, "sleep");
    expect(await fetchBestSellingOrder(transport, { clock })).toEqual(["9"]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after the retry budget", async () => {
    await expect(
      fetchBestSellingOrder(async () => ({ errors: "x" }), {
        clock: instantClock(),
        maxRetries: 1,
      }),
    ).rejects.toThrow(/retries/);
  });

  it("adapts the unauthenticated.storefront client", async () => {
    const t = storefrontContextTransport({
      graphql: async () => new Response(JSON.stringify({ data: { ok: 1 } })),
    });
    expect(await t("q", {})).toEqual({ data: { ok: 1 } });
    const failing = storefrontContextTransport({
      graphql: async () =>
        Promise.reject(Object.assign(new Error("x"), { response: { code: 430 } })),
    });
    expect((await failing("q", {})).status).toBe(430);
  });
});
