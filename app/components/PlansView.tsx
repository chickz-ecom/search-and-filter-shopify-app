import { translator, type Locale } from "../i18n";
import type { Plan, PlanId } from "../lib/billing/plans";
import type { SubscriptionInfo } from "../lib/billing/subscription.server";

// Trang Plans (task 3.9, D12): gói hiện tại, số sản phẩm so với hạn mức, các gói, nút mở trang chọn gói do Shopify
// host (Shopify App Pricing). Không dùng mẫu gây áp lực: không đếm ngược, không chặn tính năng, vượt hạn mức chỉ báo
// nhẹ (search vẫn chạy).

export type PlansViewProps = {
  locale: Locale;
  plans: Plan[];
  subscription: SubscriptionInfo;
  productCount: number;
  recommended: PlanId;
  selectionUrl: string;
  checkFailed: boolean;
};

export function PlansView(p: PlansViewProps) {
  const t = translator(p.locale);
  const lang = p.locale === "vi" ? "vi-VN" : "en-US";
  const nf = new Intl.NumberFormat(lang);
  const usd = new Intl.NumberFormat(lang, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const date = (iso: string) =>
    new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(new Date(iso));
  const current = p.plans.find((x) => x.id === p.subscription.planId) ?? p.plans[0];
  const pending = p.subscription.pendingPlanId
    ? p.plans.find((x) => x.id === p.subscription.pendingPlanId)
    : undefined;
  const over = p.productCount > current.maxProducts;
  const price = (plan: Plan) =>
    plan.priceUsd ? t("plans.perMonth", { price: usd.format(plan.priceUsd) }) : t("plans.free");

  return (
    <s-page heading={t("plans.title")} inlineSize="base">
      <s-button slot="primary-action" variant="primary" href={p.selectionUrl} target="_top">
        {t("plans.change")}
      </s-button>
      {p.checkFailed && (
        <s-banner slot="supplemental-start" tone="warning" heading={t("plans.checkFailed")}>
          <s-paragraph>{t("plans.checkFailedBody")}</s-paragraph>
        </s-banner>
      )}

      <s-section heading={t("plans.current.heading")}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>{current.name}</s-heading>
            <s-text color="subdued">{price(current)}</s-text>
          </s-stack>
          <s-stack direction="block" gap="small-300">
            <s-text>
              {t("plans.usage", {
                count: nf.format(p.productCount),
                limit: nf.format(current.maxProducts),
              })}
            </s-text>
            <s-progress
              accessibilityLabel={t("plans.usageLabel")}
              value={Math.min(p.productCount, current.maxProducts)}
              max={current.maxProducts}
              tone={over ? "warning" : "auto"}
            />
          </s-stack>
          {p.subscription.trialEndsAt && (
            <s-text color="subdued">
              {t("plans.trialEnds", { date: date(p.subscription.trialEndsAt) })}
            </s-text>
          )}
          {p.subscription.renewsAt && (
            <s-text color="subdued">
              {t(p.subscription.cancelAtEndOfCycle ? "plans.endsOn" : "plans.renewsOn", {
                date: date(p.subscription.renewsAt),
              })}
            </s-text>
          )}
          {pending && <s-text color="subdued">{t("plans.pending", { plan: pending.name })}</s-text>}
          {over && (
            <s-banner tone="info" heading={t("plans.over.heading")}>
              <s-paragraph>
                {t("plans.over.body", {
                  plan: p.plans.find((x) => x.id === p.recommended)?.name ?? "",
                })}
              </s-paragraph>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading={t("plans.all.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">{t("plans.all.desc")}</s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            {p.plans.map((plan) => (
              <s-box key={plan.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-heading>{plan.name}</s-heading>
                    {plan.id === current.id && (
                      <s-badge tone="success">{t("plans.currentBadge")}</s-badge>
                    )}
                    {plan.id === p.recommended && plan.id !== current.id && (
                      <s-badge>{t("plans.fitsBadge")}</s-badge>
                    )}
                  </s-stack>
                  <s-text>{price(plan)}</s-text>
                  <s-unordered-list>
                    <s-list-item>
                      {t("plans.products", { n: nf.format(plan.maxProducts) })}
                    </s-list-item>
                    <s-list-item>{t("plans.featuresAll")}</s-list-item>
                    {plan.headless && <s-list-item>{t("plans.headless")}</s-list-item>}
                  </s-unordered-list>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
          <s-paragraph color="subdued">{t("plans.billingNote")}</s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}
