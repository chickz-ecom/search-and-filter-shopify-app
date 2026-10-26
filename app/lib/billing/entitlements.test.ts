import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLANS,
  entitlements,
  headlessAllowed,
  planById,
  planIdFromList,
  plans,
  semanticAllowed,
  setPlans,
} from "./plans";

// Back-office (8.1): gói đọc từ registry (DB nạp vào), quyền lợi = gói hiệu lực + ghi đè theo shop.
afterEach(() => setPlans(DEFAULT_PLANS));

const now = new Date("2026-10-26T00:00:00Z");

describe("plan registry", () => {
  it("serves the plans loaded from the database, in order, and falls back to free", () => {
    setPlans([
      { ...DEFAULT_PLANS[0], position: 0 },
      { ...DEFAULT_PLANS[3], id: "pro", rpm: 99_999, position: 2 },
      { ...DEFAULT_PLANS[1], id: "starter-2026", name: "Starter 2026", position: 1 },
    ]);
    expect(plans().map((p) => p.id)).toEqual(["free", "starter-2026", "pro"]);
    expect(planById("pro").rpm).toBe(99_999);
    expect(planById("gone").id).toBe("free");
    expect(planIdFromList(["Starter-2026"])).toBe("starter-2026");
  });

  it("never runs with an empty registry", () => {
    setPlans([]);
    expect(plans()).toEqual(DEFAULT_PLANS);
  });
});

describe("entitlements", () => {
  it("uses the shop's plan when nothing is overridden", () => {
    expect(entitlements({ plan: "growth", features: {} }, now)).toEqual({
      planId: "growth",
      comped: false,
      maxProducts: 5_000,
      rpm: 6_000,
      headless: false,
      semantic: false,
      blocked: false,
    });
  });

  it("applies a complimentary plan until it expires, then the paid plan again", () => {
    const shop = {
      plan: "starter",
      features: { compPlan: "pro", compUntil: "2026-11-01T00:00:00Z" },
    };
    expect(entitlements(shop, now)).toMatchObject({ planId: "pro", comped: true, semantic: true });
    expect(entitlements(shop, new Date("2026-11-02T00:00:00Z"))).toMatchObject({
      planId: "starter",
      comped: false,
      semantic: false,
    });
    // Không hạn = tặng vĩnh viễn.
    expect(entitlements({ plan: "free", features: { compPlan: "scale" } }, now).planId).toBe(
      "scale",
    );
  });

  it("lets per-shop overrides raise limits and grant features, and blocks", () => {
    const shop = {
      plan: "free",
      features: { maxProducts: 2_000, rpm: 1_000, semantic: true, blocked: true },
    };
    expect(entitlements(shop, now)).toMatchObject({
      planId: "free",
      maxProducts: 2_000,
      rpm: 1_000,
      semantic: true,
      headless: false,
      blocked: true,
    });
    // Hàm cũ vẫn trả đúng theo gói hiệu lực (gồm gói tặng).
    expect(semanticAllowed("free", { compPlan: "pro" })).toBe(true);
    expect(headlessAllowed("starter", {})).toBe(false);
  });
});
