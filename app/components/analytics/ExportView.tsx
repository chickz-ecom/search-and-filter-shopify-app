import { translator, type Locale, type MessageKey } from "../../i18n";
import { REPORTS, type ReportKey } from "../../lib/analytics/report-types";

// Analytics → Export (7.3): tải từng báo cáo của khoảng ngày đang chọn dưới dạng CSV.

export type ExportViewProps = {
  locale: Locale;
  /** Báo cáo đang tải (nút hiện loading). */
  downloading: ReportKey | null;
  onDownload: (report: ReportKey) => void;
};

export function ExportView(p: ExportViewProps) {
  const t = translator(p.locale);
  return (
    <s-section padding="none">
      <s-box padding="base">
        <s-paragraph color="subdued">{t("analytics.export.desc")}</s-paragraph>
      </s-box>
      <s-table variant="auto">
        <s-table-header-row>
          <s-table-header listSlot="primary">{t("analytics.export.report")}</s-table-header>
          <s-table-header listSlot="inline" />
        </s-table-header-row>
        <s-table-body>
          {REPORTS.map((r) => (
            <s-table-row key={r}>
              <s-table-cell>{t(`analytics.report.${r}` as MessageKey)}</s-table-cell>
              <s-table-cell>
                <s-button
                  icon="download"
                  loading={p.downloading === r}
                  disabled={p.downloading !== null && p.downloading !== r}
                  onClick={() => p.onDownload(r)}
                >
                  {t("analytics.export.download")}
                </s-button>
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}
