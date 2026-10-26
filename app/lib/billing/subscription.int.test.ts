import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { ensureShop } from "../shop/shop.server";
import {
  ACTIVE_SUBSCRIPTION_QUERY,
  planIdFromHandles,
  planSelectionUrl,
  refreshPlan,
  type PartnerClient,
} from "./subscription.server";

const up = await postgresUp();
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("Shopify App Pricing (3.9)", () => {
  it("uses the validated Partner API query and maps plan handles", () => {
    expect(norm(ACTIVE_SUBSCRIPTION_QUERY)).toBe(
      norm(readFileSync("docs/shopify-api/admin/partner-active-subscription.graphql", "utf8")),
    );
    expect(planIdFromHandles(["usage-overage", "Pro"])).toBe("pro");
    expect(planIdFromHandles(["unknown"])).toBeNull();
    expect(planSelectionUrl("acme.myshopify.com", "search-filter")).toBe(
      "https://admin.shopify.com/store/acme/charges/search-filter/pricing_plans",
    );
  });

  describe.skipIf(!up)("refreshPlan", () => {
    const domain = `bill-${Date.now()}.myshopify.com`;
    const row = () =>
      testDb().shop.findUniqueOrThrow({
        where: { domain },
        select: { id: true, domain: true, plan: true, shopifyGid: true, planCheckedAt: true },
      });
    beforeAll(async () => {
      await ensureShop(testDb(), domain);
      await testDb().shop.update({
        where: { domain },
        data: { shopifyGid: "gid://shopify/Shop/1" },
      });
    });
    afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

    it("falls back to the stored plan when the Partner API isn't configured", async () => {
      const info = await refreshPlan(testDb(), await row(), {
        client: null,
        appGid: "gid://shopify/App/9",
      });
      expect(info).toMatchObject({ planId: "free", source: "local" });
    });

    it("stores the active plan, purges the shop context on change and reports pending changes", async () => {
      const purge = vi.fn(async () => undefined);
      const client = vi.fn(async () => ({
        activeSubscription: {
          billingPeriod: "MONTHLY",
          cancelAtEndOfCycle: false,
          trialEndsAt: null,
          currentBillingCycle: {
            startTime: "2026-10-01T00:00:00Z",
            endTime: "2026-11-01T00:00:00Z",
          },
          items: [{ handle: "pro", description: "Pro" }],
          pendingUpdate: { billingPeriod: "MONTHLY", items: [{ handle: "scale" }] },
        },
      })) as unknown as PartnerClient;
      const now = new Date("2026-10-26T00:00:00Z");
      const info = await refreshPlan(testDb(), await row(), {
        client,
        appGid: "gid://shopify/App/9",
        now,
        purge,
      });
      expect(info).toEqual({
        planId: "pro",
        source: "partner",
        billingPeriod: "MONTHLY",
        renewsAt: "2026-11-01T00:00:00Z",
        trialEndsAt: null,
        cancelAtEndOfCycle: false,
        pendingPlanId: "scale",
      });
      expect(client).toHaveBeenCalledWith(ACTIVE_SUBSCRIPTION_QUERY, {
        appId: "gid://shopify/App/9",
        shopId: "gid://shopify/Shop/1",
      });
      expect(await row()).toMatchObject({ plan: "pro", planCheckedAt: now });
      expect(purge).toHaveBeenCalledWith(domain);
    });

    it("no contract means Free", async () => {
      const client = (async () => ({ activeSubscription: null })) as unknown as PartnerClient;
      const purge = vi.fn(async () => undefined);
      expect(
        (await refreshPlan(testDb(), await row(), { client, appGid: "a", purge })).planId,
      ).toBe("free");
      expect((await row()).plan).toBe("free");
      expect(purge).toHaveBeenCalled();
    });
  });
});
