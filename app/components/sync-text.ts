import type { MessageKey } from "../i18n";
import type { SyncStatus } from "../lib/sync/status.server";

/** Dòng trạng thái sync (trang Sync + Home): đang chạy thì nói rõ giai đoạn, "x/y sản phẩm" và phần trăm. */
export function syncStatusText(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  s: SyncStatus,
  locale: string,
): string {
  const num = (n: number) => n.toLocaleString(locale);
  if (s.state === "QUEUED") return t("sync.phase.queued");
  if (s.state !== "RUNNING")
    return t("sync.indexed", { indexed: num(s.indexedCount), total: num(s.productCount) });
  const pct = ` · ${s.percent}%`;
  switch (s.phase) {
    case "prepare":
      return t("sync.phase.prepare") + pct;
    case "fetch":
      return (
        (s.fetchedProducts !== null && s.productCount
          ? t("sync.phase.fetchCount", { n: num(s.fetchedProducts), total: num(s.productCount) })
          : t("sync.phase.fetch")) + pct
      );
    case "finalize":
      return t("sync.phase.finalize") + pct;
    default:
      return t("sync.indexing", { indexed: num(s.indexedCount), total: num(s.productCount) }) + pct;
  }
}
