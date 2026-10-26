import { describe, expect, it, vi } from "vitest";
import {
  GraphqlExecutor,
  ShopifyGraphqlError,
  type GraphqlTransport,
  type RawGraphqlResponse,
} from "./graphql";

function cost(currentlyAvailable: number, requested = 10, restoreRate = 100, max = 2000) {
  return {
    requestedQueryCost: requested,
    actualQueryCost: requested,
    throttleStatus: { maximumAvailable: max, currentlyAvailable, restoreRate },
  };
}

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
}

describe("GraphqlExecutor", () => {
  it("returns data and tracks the bucket from extensions.cost", async () => {
    const transport: GraphqlTransport = vi.fn(async () => ({
      data: { ok: 1 },
      extensions: { cost: cost(1500) },
    }));
    const clock = fakeClock();
    const ex = new GraphqlExecutor(transport, clock);
    await expect(ex.query("{ shop { id } }")).resolves.toEqual({ ok: 1 });
    expect(ex.bucket).toMatchObject({ available: 1500, restoreRate: 100, max: 2000 });
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("waits for the bucket to refill before an expensive query", async () => {
    const clock = fakeClock();
    const responses: RawGraphqlResponse[] = [
      { data: {}, extensions: { cost: cost(50, 10) } },
      { data: { second: true }, extensions: { cost: cost(0, 500) } },
    ];
    const ex = new GraphqlExecutor(async () => responses.shift()!, clock);
    await ex.query("{ a }");
    await ex.query("{ b }", {}, { estimatedCost: 500 });
    // cần 500, còn 50, hồi 100/s → chờ 4.5s
    expect(clock.sleep).toHaveBeenCalledWith(4500);
  });

  it("restores the bucket over elapsed time", async () => {
    const clock = fakeClock();
    const responses: RawGraphqlResponse[] = [
      { data: {}, extensions: { cost: cost(0, 10) } },
      { data: {}, extensions: { cost: cost(500, 10) } },
    ];
    const ex = new GraphqlExecutor(async () => responses.shift()!, clock);
    await ex.query("{ a }");
    await clock.sleep(3000); // 3s trôi qua → 300 điểm
    clock.sleep.mockClear();
    await ex.query("{ b }", {}, { estimatedCost: 200 });
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("retries THROTTLED errors after waiting", async () => {
    const clock = fakeClock();
    const responses: RawGraphqlResponse[] = [
      {
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: cost(5, 400) },
      },
      { data: { ok: true }, extensions: { cost: cost(1000) } },
    ];
    const transport = vi.fn(async () => responses.shift()!);
    const ex = new GraphqlExecutor(transport, clock);
    await expect(ex.query("{ x }")).resolves.toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(clock.sleep).toHaveBeenCalledWith(3950);
  });

  it("retries transient transport failures with backoff, then gives up", async () => {
    const clock = fakeClock();
    const transport = vi.fn(async () => {
      throw Object.assign(new Error("502"), { status: 502 });
    });
    const ex = new GraphqlExecutor(transport, clock, { maxRetries: 2 });
    await expect(ex.query("{ x }")).rejects.toThrow("502");
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("throws non-retryable GraphQL errors with details", async () => {
    const ex = new GraphqlExecutor(
      async () => ({ errors: [{ message: "Field 'nope' doesn't exist" }] }),
      fakeClock(),
    );
    const err = (await ex.query("{ nope }").catch((e: unknown) => e)) as ShopifyGraphqlError;
    expect(err).toBeInstanceOf(ShopifyGraphqlError);
    expect(err.message).toContain("nope");
  });

  it("surfaces userErrors via helper", async () => {
    const ex = new GraphqlExecutor(
      async () => ({ data: { m: { userErrors: [{ field: ["a"], message: "bad" }] } } }),
      fakeClock(),
    );
    const data = await ex.query<{ m: { userErrors: { field: string[]; message: string }[] } }>(
      "mutation { m }",
    );
    expect(() => GraphqlExecutor.assertNoUserErrors(data.m.userErrors, "m")).toThrow("m: bad");
  });

  it("serializes concurrent queries through the bucket", async () => {
    const clock = fakeClock();
    let inFlight = 0;
    let maxInFlight = 0;
    const ex = new GraphqlExecutor(
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return { data: {}, extensions: { cost: cost(1000) } };
      },
      clock,
      { concurrency: 2 },
    );
    await Promise.all(Array.from({ length: 6 }, () => ex.query("{ a }")));
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe("adminContextTransport", () => {
  it("unwraps successful Response bodies", async () => {
    const { adminContextTransport } = await import("./graphql");
    const t = adminContextTransport({
      graphql: async () =>
        new Response(JSON.stringify({ data: { a: 1 }, extensions: { cost: cost(10) } })),
    });
    await expect(t("{ a }")).resolves.toMatchObject({ data: { a: 1 } });
  });

  it("maps GraphqlQueryError bodies (e.g. THROTTLED) back to raw responses", async () => {
    const { adminContextTransport } = await import("./graphql");
    const err = Object.assign(new Error("Throttled"), {
      body: {
        errors: { graphQLErrors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] },
        extensions: { cost: cost(0) },
      },
    });
    const t = adminContextTransport({ graphql: async () => Promise.reject(err) });
    const raw = await t("{ a }");
    expect(raw.errors?.[0].extensions?.code).toBe("THROTTLED");
  });

  it("attaches HTTP status to transport errors", async () => {
    const { adminContextTransport } = await import("./graphql");
    const err = Object.assign(new Error("Bad gateway"), { response: { code: 502 } });
    const t = adminContextTransport({ graphql: async () => Promise.reject(err) });
    await expect(t("{ a }")).rejects.toMatchObject({ status: 502 });
  });
});
