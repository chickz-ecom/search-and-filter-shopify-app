import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { translator, type Locale, type MessageKey } from "../../i18n";
import { METRICS, type MetricKey, type Overview } from "../../lib/analytics/report-types";
import { formatters } from "./format";

// Analytics → Overview (7.3): 6 ô số liệu (bấm để đổi biểu đồ), biểu đồ theo ngày (Polaris Viz), 7 bảng top 5.

const MetricChart = lazy(() => import("./MetricChart"));
const noopSubscribe = () => () => undefined;

export type OverviewViewProps = {
  locale: Locale;
  currency: string;
  overview: Overview;
  loading: boolean;
};

const MONEY: MetricKey[] = ["clickedValue", "boughtValue"];

function TopTable(p: {
  heading: string;
  columns: [string, string];
  rows: { id: string; label: React.ReactNode; value: string }[];
  empty: string;
  loading: boolean;
}) {
  return (
    <s-section heading={p.heading} padding="none">
      {p.rows.length === 0 ? (
        <s-box padding="base">
          <s-paragraph color="subdued">{p.empty}</s-paragraph>
        </s-box>
      ) : (
        <s-table variant="list" loading={p.loading}>
          <s-table-header-row>
            <s-table-header listSlot="primary">{p.columns[0]}</s-table-header>
            <s-table-header listSlot="labeled" format="numeric">
              {p.columns[1]}
            </s-table-header>
          </s-table-header-row>
          <s-table-body>
            {p.rows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>{r.label}</s-table-cell>
                <s-table-cell>{r.value}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
    </s-section>
  );
}

function ProductLabel({ title, image }: { title: string; image: string | null }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-thumbnail src={image ?? undefined} alt={title} size="small-200" />
      <s-text>{title}</s-text>
    </s-stack>
  );
}

export function OverviewView(p: OverviewViewProps) {
  const t = translator(p.locale);
  const f = formatters(p.locale, p.currency);
  const o = p.overview;
  const [metric, setMetric] = useState<MetricKey>("searches");
  // Polaris Viz đo DOM → chỉ render ở client (server và lần hydrate đầu trả false).
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const show = (k: MetricKey, v: number) => (MONEY.includes(k) ? f.money(v) : f.num(v));
  const metricName = t(`analytics.metric.${metric}` as MessageKey);
  const empty = t("analytics.empty");

  return (
    <s-stack direction="block" gap="base">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">{t("analytics.overview.desc")}</s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
            {METRICS.map((k) => (
              <s-clickable
                key={k}
                padding="base"
                border="base"
                borderRadius="base"
                background={k === metric ? "subdued" : "base"}
                accessibilityLabel={`${t(`analytics.metric.${k}` as MessageKey)}: ${show(k, o.totals[k])}`}
                onClick={() => setMetric(k)}
              >
                <s-stack direction="block" gap="small-300">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text color="subdued">{t(`analytics.metric.${k}` as MessageKey)}</s-text>
                    <s-icon type="info" interestFor={`sa-help-${k}`} />
                    <s-tooltip id={`sa-help-${k}`}>
                      {t(`analytics.metric.help.${k}` as MessageKey)}
                    </s-tooltip>
                  </s-stack>
                  <s-heading>{show(k, o.totals[k])}</s-heading>
                </s-stack>
              </s-clickable>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading={t("analytics.chart.title", { metric: metricName })}>
        <div style={{ height: 300 }}>
          {mounted && (
            <Suspense fallback={null}>
              <MetricChart
                name={metricName}
                points={o.series.map((s) => ({ label: f.day(s.date), value: s.values[metric] }))}
                format={(v) => show(metric, v)}
              />
            </Suspense>
          )}
        </div>
        <s-paragraph color="subdued">{t("analytics.overview.note")}</s-paragraph>
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
        <TopTable
          heading={t("analytics.top.queries")}
          columns={[t("analytics.col.query"), t("analytics.col.searches")]}
          rows={o.topQueries.map((r) => ({
            id: r.query,
            label: r.query,
            value: f.num(r.searches),
          }))}
          empty={empty}
          loading={p.loading}
        />
        <TopTable
          heading={t("analytics.top.clicked")}
          columns={[t("analytics.col.product"), t("analytics.col.clicks")]}
          rows={o.topClicked.map((r) => ({
            id: r.id,
            label: <ProductLabel title={r.title} image={r.image} />,
            value: f.num(r.clicks),
          }))}
          empty={empty}
          loading={p.loading}
        />
        <TopTable
          heading={t("analytics.top.zero")}
          columns={[t("analytics.col.query"), t("analytics.col.zeroResults")]}
          rows={o.topZero.map((r) => ({ id: r.query, label: r.query, value: f.num(r.count) }))}
          empty={empty}
          loading={p.loading}
        />
        <TopTable
          heading={t("analytics.top.bought")}
          columns={[t("analytics.col.product"), t("analytics.col.purchases")]}
          rows={o.topBought.map((r) => ({
            id: r.id,
            label: <ProductLabel title={r.title} image={r.image} />,
            value: f.num(r.purchases),
          }))}
          empty={empty}
          loading={p.loading}
        />
        <TopTable
          heading={t("analytics.top.filters")}
          columns={[t("analytics.col.filter"), t("analytics.col.uses")]}
          rows={o.topFilters.map((r) => ({ id: r.filter, label: r.filter, value: f.num(r.count) }))}
          empty={empty}
          loading={p.loading}
        />
        <TopTable
          heading={t("analytics.top.filterValues")}
          columns={[t("analytics.col.value"), t("analytics.col.uses")]}
          rows={o.topFilterValues.map((r) => ({
            id: `${r.filter}|${r.value}`,
            label: `${r.filter}: ${r.value === "true" ? t("analytics.value.true") : r.value}`,
            value: f.num(r.count),
          }))}
          empty={empty}
          loading={p.loading}
        />
        <TopTable
          heading={t("analytics.top.collections")}
          columns={[t("analytics.col.collection"), t("analytics.col.views")]}
          rows={o.topCollections.map((r) => ({ id: r.id, label: r.title, value: f.num(r.views) }))}
          empty={empty}
          loading={p.loading}
        />
      </s-grid>
    </s-stack>
  );
}
