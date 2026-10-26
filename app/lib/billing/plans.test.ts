import { describe, expect, it } from "vitest";
import { headlessDecision, planForProductCount, semanticAllowed } from "./plans";

describe("plans", () => {
  it("picks the smallest plan that fits the catalog", () => {
    expect(planForProductCount(50).id).toBe("free");
    expect(planForProductCount(100).id).toBe("starter");
    expect(planForProductCount(30_000).id).toBe("pro");
    expect(planForProductCount(2_000_000).id).toBe("enterprise");
  });

  it("AI search is included from Pro, or granted per shop", () => {
    expect(semanticAllowed("growth")).toBe(false);
    expect(semanticAllowed("growth", { semantic: true })).toBe(true);
    expect(semanticAllowed("pro")).toBe(true);
  });

  it("headless needs the plan, the merchant opt-in and an allowed origin", () => {
    expect(headlessDecision("growth", { headlessEnabled: true }, "https://app.example")).toBe(
      "not_in_plan",
    );
    expect(headlessDecision("growth", { headless: true, headlessEnabled: true }, null)).toBe("ok");
    expect(headlessDecision("pro", {}, "https://app.example")).toBe("disabled");
    expect(headlessDecision("pro", { headlessEnabled: true }, "https://app.example")).toBe("ok");
    const allow = { headlessEnabled: true, headlessOrigins: ["https://app.example"] };
    expect(headlessDecision("pro", allow, "https://APP.example")).toBe("ok");
    expect(headlessDecision("pro", allow, "https://evil.example")).toBe("origin_not_allowed");
    expect(headlessDecision("pro", allow, null)).toBe("ok"); // server-to-server
  });
});
