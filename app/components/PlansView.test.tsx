import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "../lib/billing/plans";
import { PlansView, type PlansViewProps } from "./PlansView";

const base: PlansViewProps = {
  locale: "en",
  plans: DEFAULT_PLANS,
  subscription: {
    planId: "growth",
    source: "partner",
    billingPeriod: "MONTHLY",
    renewsAt: "2026-11-01T00:00:00Z",
    trialEndsAt: null,
    cancelAtEndOfCycle: false,
    pendingPlanId: null,
  },
  productCount: 1200,
  recommended: "growth",
  selectionUrl: "https://admin.shopify.com/store/acme/charges/search-filter/pricing_plans",
  checkFailed: false,
};

describe("PlansView (3.9)", () => {
  it("shows the current plan, usage against the limit and the Shopify plan page link", () => {
    const html = renderToStaticMarkup(<PlansView {...base} />);
    expect(html).toContain("1,200 of 5,000 products");
    expect(html).toMatch(/<s-progress[^>]*value="1200"[^>]*max="5000"/);
    expect(html).toContain("Renews Nov 1, 2026");
    expect(html).toMatch(
      /href="https:\/\/admin\.shopify\.com\/store\/acme\/charges\/search-filter\/pricing_plans"[^>]*target="_top"/,
    );
    expect(html).toContain("$19/month");
    expect((html.match(/>Current</g) ?? []).length).toBe(1);
  });

  it("over the limit: a calm info notice, never a critical/pressure message", () => {
    const html = renderToStaticMarkup(
      <PlansView {...base} productCount={7000} recommended="pro" />,
    );
    expect(html).toContain('tone="info"');
    expect(html).not.toContain('tone="critical"');
    expect(html).toContain("Search keeps working for all your products");
    expect(html).toContain("the Pro plan fits your catalog");
    expect(html).toContain("Fits your catalog");
  });

  it("shows pending changes, a check failure and Vietnamese", () => {
    const html = renderToStaticMarkup(
      <PlansView
        {...base}
        locale="vi"
        checkFailed
        subscription={{ ...base.subscription, pendingPlanId: "pro", cancelAtEndOfCycle: true }}
      />,
    );
    expect(html).toContain("Chuyển sang Pro ở kỳ thanh toán tới");
    expect(html).toContain("Không kiểm tra được gói với Shopify");
    expect(html).toContain("Kết thúc");
  });
});
