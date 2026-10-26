import { translator, type Locale, type MessageKey } from "../../i18n";
import type { SynonymSuggestion } from "../../lib/merch/synonym-suggestions.server";

// Gợi ý synonym từ từ khoá 0 kết quả (5.3) — merchant duyệt hoặc bỏ qua. Hiện ở Analytics → Search → 0 results.
export function SynonymSuggestions(p: {
  locale: Locale;
  suggestions: SynonymSuggestion[];
  busy: boolean;
  onSuggestion: (intent: "approve" | "dismiss", s: SynonymSuggestion) => void;
}) {
  const t = translator(p.locale);
  const nf = new Intl.NumberFormat(p.locale === "vi" ? "vi-VN" : "en-US");
  if (!p.suggestions.length) return null;
  return (
    <s-section heading={t("analytics.suggest.heading")}>
      <s-stack direction="block" gap="small-200">
        <s-paragraph color="subdued">{t("analytics.suggest.desc")}</s-paragraph>
        <s-table variant="auto" loading={p.busy}>
          <s-table-header-row>
            <s-table-header listSlot="primary">{t("analytics.query")}</s-table-header>
            <s-table-header listSlot="labeled">{t("analytics.suggest.term")}</s-table-header>
            <s-table-header listSlot="labeled">{t("analytics.suggest.why")}</s-table-header>
            <s-table-header listSlot="inline" />
          </s-table-header-row>
          <s-table-body>
            {p.suggestions.map((sg) => (
              <s-table-row key={sg.query}>
                <s-table-cell>{sg.query}</s-table-cell>
                <s-table-cell>
                  {t("analytics.suggest.finds", { term: sg.term, n: nf.format(sg.products) })}
                </s-table-cell>
                <s-table-cell>
                  <s-badge>{t(`analytics.suggest.reason.${sg.reason}` as MessageKey)}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-button-group>
                    <s-button
                      slot="primary-action"
                      variant="primary"
                      disabled={p.busy}
                      onClick={() => p.onSuggestion("approve", sg)}
                    >
                      {t("analytics.suggest.approve")}
                    </s-button>
                    <s-button
                      slot="secondary-actions"
                      disabled={p.busy}
                      onClick={() => p.onSuggestion("dismiss", sg)}
                    >
                      {t("analytics.suggest.dismiss")}
                    </s-button>
                  </s-button-group>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-stack>
    </s-section>
  );
}
