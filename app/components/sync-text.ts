import type { MessageKey } from "../i18n";
import type { SyncStatus } from "../lib/sync/status.server";

/** Dòng trạng thái sync (trang Sync + Home): đang chạy thì nói rõ giai đoạn + phần trăm. */
export function syncStatusText(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  s: SyncStatus,
): string {
  if (s.state === "QUEUED") return t("sync.phase.queued");
  if (s.state !== "RUNNING")
    return t("sync.indexed", { indexed: s.indexedCount, total: s.productCount });
  const pct = ` · ${s.percent}%`;
  switch (s.phase) {
    case "prepare":
      return t("sync.phase.prepare") + pct;
    case "fetch":
      return (
        (s.fetched ? t("sync.phase.fetchCount", { n: s.fetched }) : t("sync.phase.fetch")) + pct
      );
    case "finalize":
      return t("sync.phase.finalize") + pct;
    default:
      return t("sync.indexing", { indexed: s.indexedCount, total: s.productCount }) + pct;
  }
}
