import type { Locale, MessageKey } from "../i18n";
import { syncStatusText } from "./sync-text";
import { translator } from "../i18n";
import type { SyncStatus } from "../lib/sync/status.server";

// UI trang Sync (props thuần → validate bằng Polaris App Home v2.0 và test được).
export type SyncJobRow = {
  id: string;
  type: "FULL" | "INCREMENTAL" | "RECONCILE" | "CHECKSUM" | "REINDEX";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  startedAt: string;
  durationMs: number | null;
  imported: number;
  error: string | null;
};

export type SyncViewProps = {
  locale: Locale;
  status: SyncStatus;
  jobs: SyncJobRow[];
  hint: MessageKey | null;
  submitting: boolean;
  onSyncNow: () => void;
  /** Dựng lại index từ dữ liệu đang có (không gọi Shopify). */
  onReindex: () => void;
};

const formatDate = (iso: string | null, locale: string) =>
  iso
    ? new Date(iso).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

const formatDuration = (ms: number | null) =>
  ms === null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;

const stateTone = { IDLE: "success", QUEUED: "info", RUNNING: "info", ERROR: "critical" } as const;
const jobTone = {
  QUEUED: "info",
  RUNNING: "info",
  SUCCEEDED: "success",
  FAILED: "critical",
  CANCELLED: "neutral",
} as const;

export function SyncView({
  locale,
  status,
  jobs,
  hint,
  submitting,
  onSyncNow,
  onReindex,
}: SyncViewProps) {
  const t = translator(locale);
  const busy = status.state === "RUNNING" || status.state === "QUEUED" || submitting;

  return (
    <s-page heading={t("sync.title")} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.home")}
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={submitting}
        disabled={busy}
        onClick={onSyncNow}
      >
        {t("sync.now")}
      </s-button>
      <s-button slot="secondary-actions" disabled={busy} onClick={onReindex}>
        {t("sync.reindex")}
      </s-button>

      {status.lastError && hint && (
        <s-banner slot="supplemental-start" tone="critical" heading={t("sync.error.heading")}>
          <s-paragraph>{t(hint)}</s-paragraph>
          <s-paragraph tone="neutral">{status.lastError.message}</s-paragraph>
        </s-banner>
      )}

      <s-section heading={t("sync.status")}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={stateTone[status.state]}>
              {t(`sync.state.${status.state}` as MessageKey)}
            </s-badge>
            <s-text>{syncStatusText(t, status, locale)}</s-text>
          </s-stack>
          {(status.state === "RUNNING" || status.state === "QUEUED") && (
            <s-progress
              value={status.percent}
              max={100}
              accessibilityLabel={t("sync.state.RUNNING")}
            />
          )}
          <s-paragraph>
            {t("sync.lastFull")}: {formatDate(status.lastFullSyncAt, locale) ?? t("common.never")} ·{" "}
            {t("sync.lastIncremental")}:{" "}
            {formatDate(status.lastIncrementalAt, locale) ?? t("common.never")}
          </s-paragraph>
          <s-paragraph tone="neutral">{t("sync.explain")}</s-paragraph>
          <s-paragraph tone="neutral">{t("sync.actionsHelp")}</s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading={t("sync.history")} padding="none">
        {jobs.length ? (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("sync.col.type")}</s-table-header>
              <s-table-header listSlot="inline">{t("sync.col.status")}</s-table-header>
              <s-table-header listSlot="labeled">{t("sync.col.started")}</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">
                {t("sync.col.duration")}
              </s-table-header>
              <s-table-header listSlot="labeled" format="numeric">
                {t("sync.col.result")}
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {jobs.map((j) => (
                <s-table-row key={j.id}>
                  <s-table-cell>{t(`sync.job.${j.type}` as MessageKey)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={jobTone[j.status]}>
                      {t(`sync.jobStatus.${j.status}` as MessageKey)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{formatDate(j.startedAt, locale)}</s-table-cell>
                  <s-table-cell>{formatDuration(j.durationMs)}</s-table-cell>
                  <s-table-cell>{j.imported ? j.imported.toLocaleString() : "—"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-box padding="base">
            <s-paragraph>{t("sync.empty")}</s-paragraph>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}
