import { describe, expect, it } from "vitest";
import { syncSteps } from "./steps";

describe("syncSteps", () => {
  it("full sync while downloading: each download has its own state, later steps wait", () => {
    const steps = syncSteps(
      {
        phase: "fetch",
        percent: 22,
        bulks: {
          products: { n: 34_649, done: true },
          variants: { n: 61_200, done: false },
          collections: { n: 0, done: false },
        },
      },
      "FULL",
      { indexed: 0, total: 34_649 },
    );
    expect(steps).toEqual([
      { key: "products", state: "done", n: 34_649, total: 34_649 },
      { key: "variants", state: "active", n: 61_200 },
      { key: "collections", state: "active" },
      { key: "save", state: "waiting" },
      { key: "live", state: "waiting" },
    ]);
  });

  it("full sync while saving: downloads done, save shows x/y", () => {
    const steps = syncSteps({ phase: "index", percent: 80 }, "FULL", {
      indexed: 12_000,
      total: 34_649,
    });
    expect(steps.map((s) => [s.key, s.state])).toEqual([
      ["products", "done"],
      ["variants", "done"],
      ["collections", "done"],
      ["save", "active"],
      ["live", "waiting"],
    ]);
    expect(steps[3]).toMatchObject({ n: 12_000, total: 34_649 });
  });

  it("reindex has no Shopify download: rebuild then switch", () => {
    expect(
      syncSteps({ phase: "finalize", percent: 97 }, "REINDEX", { indexed: 10, total: 10 }),
    ).toEqual([
      { key: "rebuild", state: "done" },
      { key: "live", state: "active" },
    ]);
  });

  it("product count never exceeds the catalog size", () => {
    const [products] = syncSteps(
      { phase: "fetch", percent: 40, bulks: { products: { n: 120, done: false } } },
      "FULL",
      { indexed: 0, total: 100 },
    );
    expect(products).toMatchObject({ state: "active", n: 100, total: 100 });
  });
});
