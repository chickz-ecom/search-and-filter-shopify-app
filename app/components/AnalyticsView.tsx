import type { ReactNode } from "react";
import { translator, type Locale, type MessageKey } from "../i18n";
import type { AnalyticsReport, Range, UsageRow } from "../lib/analytics/report.server";
import type { SynonymSuggestion } from "../lib/merch/synonym-suggestions.server";

// Trang Analytics (task 3.7, mục 8): KPI theo khoảng thời gian, top query, query không có kết quả kèm nút tạo
// synonym/redirect nhanh (mở sẵn modal ở Merchandising qua ?new=), mức dùng filter và sort.

export type AnalyticsViewProps = {
  locale: Locale;
  currency: string;
  report: AnalyticsReport;
  loading: boolean;
  onRangeChange: (range: Range) => void;
  /** Gợi ý synonym từ truy vấn 0 kết quả (5.3) — merchant duyệt. */
  suggestions?: SynonymSuggestion[];
  busy?: boolean;
  onSuggestion?: (intent: "approve" | "dismiss", s: SynonymSuggestion) => void;
};

const RANGE_OPTIONS: Range[] = [7, 30, 90];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const trend = (cur: number, prev: number) => {
  if (!prev) return null;
  const d = (cur - prev) / prev;
  return `${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)}%`;
};
const merchLink = (type: "synonyms" | "redirects", q: string) =>
  `/app/merchandising/${type}?new=${encodeURIComponent(q)}`;

function Table({
  headers,
  rows,
  loading,
}: {
  headers: string[];
  rows: { id: string; cells: ReactNode[] }[];
  loading: boolean;
}) {
  return (
    <s-table variant="auto" loading={loading}>
      <s-table-header-row>
        {headers.map((h, i) => (
          <s-table-header
            key={h || i}
            listSlot={i === 0 ? "primary" : "labeled"}
            format={i > 0 && h ? "numeric" : undefined}
          >
            {h}
          </s-table-header>
        ))}
      </s-table-header-row>
      <s-table-body>
        {rows.map((r) => (
          <s-table-row key={r.id}>
            {r.cells.map((c, i) => (
              <s-table-cell key={i}>{c}</s-table-cell>
            ))}
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

export function AnalyticsView(p: AnalyticsViewProps) {
  const t = translator(p.locale);
  const r = p.report;
  const k = r.kpis;
  const nf = new Intl.NumberFormat(p.locale === "vi" ? "vi-VN" : "en-US");
  const money = new Intl.NumberFormat(p.locale === "vi" ? "vi-VN" : "en-US", {
    style: "currency",
    currency: p.currency,
  });
  const empty = k.searches === 0;
  const usage = (rows: UsageRow[], withValue: boolean) =>
    rows.map((u) => ({
      id: `${u.key}|${u.value}`,
      cells: [withValue ? `${u.label}: ${u.value}` : u.label, nf.format(u.count), pct(u.share)],
    }));

  return (
    <s-page heading={t("analytics.title")} inlineSize="large">
      <s-section heading={t("analytics.overview")}>
        <s-stack direction="block" gap="base">
          <s-select
            label={t("analytics.range")}
            value={String(r.range)}
            onChange={(e) => p.onRangeChange(Number(e.currentTarget.value) as Range)}
          >
            {RANGE_OPTIONS.map((n) => (
              <s-option key={n} value={String(n)}>
                {t("analytics.lastDays", { n })}
              </s-option>
            ))}
          </s-select>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            {[
              {
                label: t("home.kpi.searches"),
                value: nf.format(k.searches),
                trend: trend(k.searches, k.previous.searches),
              },
              {
                label: t("home.kpi.zero"),
                value: pct(k.zeroResultRate),
                trend: trend(k.zeroResultRate, k.previous.zeroResultRate),
              },
              { label: t("home.kpi.ctr"), value: pct(k.ctr), trend: trend(k.ctr, k.previous.ctr) },
              { label: t("analytics.addToCarts"), value: nf.format(k.addToCarts), trend: null },
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
                      {m.trend} {t("analytics.vsPrevious", { n: r.range })}
                    </s-text>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      {empty ? (
        <s-section>
          <s-paragraph color="subdued">{t("home.kpi.empty")}</s-paragraph>
        </s-section>
      ) : (
        <>
          {(p.suggestions?.length ?? 0) > 0 && (
            <s-section heading={t("analytics.suggest.heading")}>
              <s-stack direction="block" gap="small-200">
                <s-paragraph color="subdued">{t("analytics.suggest.desc")}</s-paragraph>
                <Table
                  loading={p.busy ?? false}
                  headers={[
                    t("analytics.query"),
                    t("analytics.suggest.term"),
                    t("analytics.suggest.why"),
                    "",
                  ]}
                  rows={p.suggestions!.map((sg) => ({
                    id: sg.query,
                    cells: [
                      sg.query,
                      t("analytics.suggest.finds", { term: sg.term, n: nf.format(sg.products) }),
                      <s-badge key="r">
                        {t(`analytics.suggest.reason.${sg.reason}` as MessageKey)}
                      </s-badge>,
                      <s-button-group key="a">
                        <s-button
                          slot="primary-action"
                          variant="primary"
                          disabled={p.busy}
                          onClick={() => p.onSuggestion?.("approve", sg)}
                        >
                          {t("analytics.suggest.approve")}
                        </s-button>
                        <s-button
                          slot="secondary-actions"
                          disabled={p.busy}
                          onClick={() => p.onSuggestion?.("dismiss", sg)}
                        >
                          {t("analytics.suggest.dismiss")}
                        </s-button>
                      </s-button-group>,
                    ],
                  }))}
                />
              </s-stack>
            </s-section>
          )}

          <s-section heading={t("analytics.zero.heading")}>
            <s-stack direction="block" gap="small-200">
              <s-paragraph color="subdued">{t("analytics.zero.desc")}</s-paragraph>
              {r.zeroResults.length === 0 ? (
                <s-paragraph>{t("analytics.zero.none")}</s-paragraph>
              ) : (
                <Table
                  loading={p.loading}
                  headers={[t("analytics.query"), t("analytics.noResultSearches"), ""]}
                  rows={r.zeroResults.map((q) => ({
                    id: q.query,
                    cells: [
                      q.query,
                      nf.format(q.zeroResults),
                      <s-button-group key="a">
                        <s-button slot="secondary-actions" href={merchLink("synonyms", q.query)}>
                          {t("analytics.addSynonym")}
                        </s-button>
                        <s-button slot="secondary-actions" href={merchLink("redirects", q.query)}>
                          {t("analytics.addRedirect")}
                        </s-button>
                      </s-button-group>,
                    ],
                  }))}
                />
              )}
            </s-stack>
          </s-section>

          <s-section heading={t("analytics.top.heading")}>
            <Table
              loading={p.loading}
              headers={[
                t("analytics.query"),
                t("home.kpi.searches"),
                t("home.kpi.ctr"),
                t("analytics.addToCarts"),
                t("analytics.revenue"),
              ]}
              rows={r.topQueries.map((q) => ({
                id: q.query,
                cells: [
                  q.query,
                  nf.format(q.searches),
                  pct(q.ctr),
                  nf.format(q.addToCarts),
                  money.format(q.revenue),
                ],
              }))}
            />
          </s-section>

          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
            {(
              [
                ["analytics.filters.heading", r.filterUsage, true],
                ["analytics.sorts.heading", r.sortUsage, false],
              ] as const
            ).map(([heading, rows, withValue]) => (
              <s-section key={heading} heading={t(heading as MessageKey)}>
                {rows.length === 0 ? (
                  <s-paragraph color="subdued">{t("analytics.usage.none")}</s-paragraph>
                ) : (
                  <Table
                    loading={p.loading}
                    headers={[
                      t(withValue ? "analytics.filter" : "analytics.sort"),
                      t("analytics.uses"),
                      t("analytics.share"),
                    ]}
                    rows={usage(rows, withValue)}
                  />
                )}
              </s-section>
            ))}
          </s-grid>
        </>
      )}
    </s-page>
  );
}
