import type { ReactNode } from "react";
import { translator, type Locale, type MessageKey } from "../../i18n";
import type { Column, Row } from "../../lib/analytics/report-types";
import { formatters } from "./format";

// Analytics → Search / Collections (7.3): các tab báo cáo, ô tìm, sắp xếp, bảng có phân trang (s-table paginate).

export type PagedTable = {
  columns: Column[];
  rows: Row[];
  total: number;
  page: number;
  pages: number;
  sort: string;
  dir: "asc" | "desc";
};

export type ReportViewProps = {
  locale: Locale;
  currency: string;
  description: string;
  tabs: { key: string; label: string }[];
  activeTab: string;
  table: PagedTable;
  q: string;
  loading: boolean;
  onTab: (tab: string) => void;
  onQuery: (q: string) => void;
  onSort: (sort: string, dir: "asc" | "desc") => void;
  onPage: (page: number) => void;
  /** Khối thêm phía trên bảng (vd. gợi ý synonym ở tab 0 kết quả). */
  before?: ReactNode;
  /** Cột hành động cuối mỗi dòng (vd. Add synonym / Add redirect). */
  rowActions?: (row: Row) => ReactNode;
};

export function ReportView(p: ReportViewProps) {
  const t = translator(p.locale);
  const f = formatters(p.locale, p.currency);
  const col = (key: string) => t(`analytics.col.${key}` as MessageKey);
  const cell = (c: Column, r: Row): ReactNode => {
    const v = r[c.key];
    switch (c.kind) {
      case "number":
        return f.num(Number(v ?? 0));
      case "money":
        return f.money(Number(v ?? 0));
      case "percent":
        return f.pct(Number(v ?? 0));
      case "product":
        return (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-thumbnail src={r._image ?? undefined} alt={String(v ?? "")} size="small-200" />
            <s-text>{String(v ?? "")}</s-text>
          </s-stack>
        );
      default:
        return v === "true" ? t("analytics.value.true") : String(v ?? "");
    }
  };
  const help = p.table.columns.filter((c) => c.key === "ctr" || c.key === "cr");

  return (
    <s-stack direction="block" gap="base">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">{p.description}</s-paragraph>
          <s-button-group>
            {p.tabs.map((tab) => (
              <s-button
                key={tab.key}
                slot={tab.key === p.activeTab ? "primary-action" : "secondary-actions"}
                variant={tab.key === p.activeTab ? "primary" : "secondary"}
                onClick={() => p.onTab(tab.key)}
              >
                {tab.label}
              </s-button>
            ))}
          </s-button-group>
        </s-stack>
      </s-section>

      {p.before}

      <s-section padding="none">
        <s-box padding="base">
          <s-grid gridTemplateColumns="1fr auto auto" gap="base" alignItems="end">
            <s-search-field
              label={t("analytics.find")}
              labelAccessibilityVisibility="exclusive"
              placeholder={t("analytics.find")}
              value={p.q}
              onInput={(e) => p.onQuery(e.currentTarget.value)}
            />
            <s-select
              label={t("analytics.sortBy")}
              value={p.table.sort}
              onChange={(e) => p.onSort(e.currentTarget.value, p.table.dir)}
            >
              {p.table.columns.map((c) => (
                <s-option key={c.key} value={c.key}>
                  {col(c.key)}
                </s-option>
              ))}
            </s-select>
            <s-select
              label={t("analytics.sortBy")}
              labelAccessibilityVisibility="exclusive"
              value={p.table.dir}
              onChange={(e) => p.onSort(p.table.sort, e.currentTarget.value as "asc" | "desc")}
            >
              <s-option value="desc">{t("analytics.sortDir.desc")}</s-option>
              <s-option value="asc">{t("analytics.sortDir.asc")}</s-option>
            </s-select>
          </s-grid>
        </s-box>
        {p.table.rows.length === 0 ? (
          <s-box padding="base">
            <s-paragraph color="subdued">{t("analytics.empty")}</s-paragraph>
          </s-box>
        ) : (
          <s-table
            variant="auto"
            loading={p.loading}
            paginate={p.table.pages > 1}
            hasPreviousPage={p.table.page > 1}
            hasNextPage={p.table.page < p.table.pages}
            onPreviousPage={() => p.onPage(p.table.page - 1)}
            onNextPage={() => p.onPage(p.table.page + 1)}
          >
            <s-table-header-row>
              {p.table.columns.map((c, i) => (
                <s-table-header
                  key={c.key}
                  listSlot={i === 0 ? "primary" : "labeled"}
                  format={c.kind === "text" || c.kind === "product" ? undefined : "numeric"}
                >
                  {col(c.key)}
                </s-table-header>
              ))}
              {p.rowActions && <s-table-header listSlot="inline" />}
            </s-table-header-row>
            <s-table-body>
              {p.table.rows.map((r, i) => (
                <s-table-row key={`${p.table.page}-${i}`}>
                  {p.table.columns.map((c) => (
                    <s-table-cell key={c.key}>{cell(c, r)}</s-table-cell>
                  ))}
                  {p.rowActions && <s-table-cell>{p.rowActions(r)}</s-table-cell>}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        <s-box padding="base">
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">{t("analytics.rows", { n: f.num(p.table.total) })}</s-text>
            {help.map((c) => (
              <s-text key={c.key} color="subdued">
                {col(c.key)}: {t(`analytics.help.${c.key}` as MessageKey)}
              </s-text>
            ))}
          </s-stack>
        </s-box>
      </s-section>
    </s-stack>
  );
}
