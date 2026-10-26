import { describe, expect, it } from "vitest";
import { diffChecksum, driftRatio } from "./checksum.server";

describe("diffChecksum (1.9)", () => {
  const shopify = new Map([
    ["1", 100],
    ["2", 200],
    ["3", 300],
  ]);

  it("finds missing, stale and extra IDs; newer index rows are not stale", () => {
    const index = new Map([
      ["1", { id: "1", updated_at: 100 }],
      ["2", { id: "2", updated_at: 150 }],
      ["4", { id: "4", updated_at: 1 }],
    ]);
    const d = diffChecksum(shopify, index);
    expect(d).toMatchObject({ missing: ["3"], stale: ["2"], extra: ["4"], shopifyCount: 3 });
    expect(driftRatio(d)).toBeCloseTo(1); // 3 lệch / 3
  });

  it("reports nothing when in sync (no engine writes needed)", () => {
    const index = new Map([
      ["1", { id: "1", updated_at: 100, collections: ["9"] }],
      ["2", { id: "2", updated_at: 205, collections: [] }],
      ["3", { id: "3", updated_at: 300, collections: ["9", "unpublished"] }],
    ]);
    const membership = new Map([
      ["1", new Set(["9"])],
      ["3", new Set(["9"])],
    ]);
    const d = diffChecksum(shopify, index, membership, new Set(["9"]));
    expect(d).toMatchObject({ missing: [], stale: [], extra: [], collections: [] });
    expect(driftRatio(d)).toBe(0);
  });

  it("flags collections whose membership drifted", () => {
    const index = new Map([
      ["1", { id: "1", updated_at: 100, collections: ["9"] }],
      ["2", { id: "2", updated_at: 200, collections: [] }],
      ["3", { id: "3", updated_at: 300, collections: [] }],
    ]);
    const membership = new Map([["2", new Set(["8"])]]);
    expect(diffChecksum(shopify, index, membership, new Set(["8", "9"])).collections).toEqual([
      "8",
      "9",
    ]);
  });
});
