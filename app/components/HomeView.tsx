import { syncStatusText } from "./sync-text";
import { translator, type Locale, type MessageKey } from "../i18n";
import type { EmbedStatus, ThemeLinks } from "../lib/admin/theme-links";
import type { Kpis } from "../lib/analytics/kpi.server";
import type { SyncStatus } from "../lib/sync/status.server";

// Home (task 3.1, BFS 3.1.4 / 4.2.x): checklist cài đặt (trạng thái embed qua shopify.app.extensions()), card sync, KPI 7 ngày.

export type OnboardingState = {
  dismissed: boolean;
  search?: string;
  sorting?: string;
  filters?: string;
  preview?: string;
};

export type HomeViewProps = {
  locale: Locale;
  shopDomain: string;
  currency: string;
  status: SyncStatus;
  kpis: Kpis;
  onboarding: OnboardingState;
  links: ThemeLinks;
  /** null = đang đọc shopify.app.extensions(). */
  embed: EmbedStatus | null;
  onDismiss: () => void;
  onPreview: () => void;
};

type Step = {
  key: string;
  title: MessageKey;
  desc?: MessageKey;
  done: boolean;
  href: string;
  action: MessageKey;
  external?: boolean;
  onClick?: () => void;
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function trend(cur: number, prev: number) {
  if (!prev) return null;
  const d = (cur - prev) / prev;
  return `${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)}%`;
}

export function HomeView(p: HomeViewProps) {
  const t = translator(p.locale);
  const steps: Step[] = [
    {
      key: "embed",
      title: "home.step.embed",
      desc: "home.step.embed.desc",
      done: Boolean(p.embed?.embedEnabled),
      href: p.links.embed,
      action: "home.step.embed.action",
      external: true,
    },
    {
      key: "collection",
      title: "home.step.collectionBlock",
      desc: "home.step.collectionBlock.desc",
      done: Boolean(p.embed?.collectionBlockAdded),
      href: p.links.collectionBlock,
      action: "home.step.addBlock",
      external: true,
    },
    {
      key: "searchBlock",
      title: "home.step.searchBlock",
      desc: "home.step.searchBlock.desc",
      done: Boolean(p.embed?.searchBlockAdded),
      href: p.links.searchBlock,
      action: "home.step.addBlock",
      external: true,
    },
    {
      key: "search",
      title: "home.step.search",
      done: Boolean(p.onboarding.search),
      href: "/app/search",
      action: "home.step.open",
    },
    {
      key: "sorting",
      title: "home.step.sorting",
      done: Boolean(p.onboarding.sorting),
      href: "/app/sorting",
      action: "home.step.open",
    },
    {
      key: "filters",
      title: "home.step.filters",
      done: Boolean(p.onboarding.filters),
      href: "/app/filters",
      action: "home.step.open",
    },
    {
      key: "preview",
      title: "home.step.preview",
      done: Boolean(p.onboarding.preview),
      href: `https://${p.shopDomain}/search?q=`,
      action: "home.step.preview.action",
      external: true,
      onClick: p.onPreview,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const k = p.kpis;
  const money = new Intl.NumberFormat(p.locale === "vi" ? "vi-VN" : "en-US", {
    style: "currency",
    currency: p.currency,
  });

  return (
    <s-page heading={t("home.title")} inlineSize="base">
      {next && (
        <s-button
          slot="primary-action"
          variant="primary"
          href={next.href}
          target={next.external ? "_blank" : undefined}
          onClick={next.onClick}
        >
          {t(next.title)}
        </s-button>
      )}

      {p.status.state === "ERROR" && (
        <s-banner slot="supplemental-start" tone="critical" heading={t("sync.error.heading")}>
          <s-paragraph>{t("sync.fix.generic")}</s-paragraph>
          <s-link slot="secondary-actions" href="/app/sync">
            {t("home.sync.view")}
          </s-link>
        </s-banner>
      )}

      {!p.onboarding.dismissed && (
        <s-section heading={t("home.setup.heading")}>
          <s-button slot="secondary-actions" variant="tertiary" onClick={p.onDismiss}>
            {t("home.setup.dismiss")}
          </s-button>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>{t("home.setup.progress", { done, total: steps.length })}</s-text>
              <s-badge
                tone={p.embed === null ? "neutral" : p.embed.embedEnabled ? "success" : "warning"}
              >
                {p.embed === null
                  ? t("home.embed.unknown")
                  : p.embed.embedEnabled
                    ? t("home.embed.on")
                    : t("home.embed.off")}
              </s-badge>
            </s-stack>
            <s-progress
              value={done}
              max={steps.length}
              accessibilityLabel={t("home.setup.progress", { done, total: steps.length })}
            />
            {steps.map((s) => (
              <s-box key={s.key} padding="small-200" borderWidth="base" borderRadius="base">
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon
                      type={s.done ? "check-circle" : "circle"}
                      tone={s.done ? "success" : "neutral"}
                    />
                    <s-stack direction="block" gap="small-500">
                      <s-text type="strong">{t(s.title)}</s-text>
                      {s.desc && <s-text color="subdued">{t(s.desc)}</s-text>}
                    </s-stack>
                  </s-stack>
                  {s.done ? (
                    <s-badge tone="success">{t("home.setup.done")}</s-badge>
                  ) : (
                    <s-button
                      href={s.href}
                      target={s.external ? "_blank" : undefined}
                      onClick={s.onClick}
                    >
                      {t(s.action)}
                    </s-button>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("home.kpi.heading")}>
        <s-link slot="secondary-actions" href="/app/analytics">
          {t("home.kpi.view")}
        </s-link>
        {k.searches === 0 ? (
          <s-paragraph color="subdued">{t("home.kpi.empty")}</s-paragraph>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            {[
              {
                label: t("home.kpi.searches"),
                value: k.searches.toLocaleString(),
                trend: trend(k.searches, k.previous.searches),
              },
              { label: t("home.kpi.zero"), value: pct(k.zeroResultRate), trend: null },
              { label: t("home.kpi.ctr"), value: pct(k.ctr), trend: trend(k.ctr, k.previous.ctr) },
              {
                label: t("home.kpi.revenue"),
                value: money.format(k.revenue),
                trend: trend(k.revenue, k.previous.revenue),
              },
            ].map((m) => (
              <s-box key={m.label} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-300">
                  <s-text color="subdued">{m.label}</s-text>
                  <s-heading>{m.value}</s-heading>
                  {m.trend && (
                    <s-text color="subdued">
                      {m.trend} {t("home.kpi.vsPrevious")}
                    </s-text>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-grid>
        )}
      </s-section>

      <s-section heading={t("home.sync.heading")}>
        <s-link slot="secondary-actions" href="/app/sync">
          {t("home.sync.view")}
        </s-link>
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge
              tone={
                p.status.state === "ERROR"
                  ? "critical"
                  : p.status.state === "IDLE"
                    ? "success"
                    : "info"
              }
            >
              {t(`sync.state.${p.status.state}` as MessageKey)}
            </s-badge>
            <s-text>{syncStatusText(t, p.status)}</s-text>
          </s-stack>
          {(p.status.state === "RUNNING" || p.status.state === "QUEUED") && (
            <s-progress
              value={p.status.percent}
              max={100}
              accessibilityLabel={t("sync.state.RUNNING")}
            />
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
