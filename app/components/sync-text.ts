import type { MessageKey } from "../i18n";
import type { SyncStatus } from "../lib/sync/status.server";

/** Dòng trạng thái sync (trang Sync + Home): giai đoạn đang chạy + phần trăm của CẢ lượt (không phải của một bước). */
export function syncStatusText(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  s: SyncStatus,
  locale: string,
): string {
  const num = (n: number) => n.toLocaleString(locale);
  if (s.state === "QUEUED") return t("sync.phase.queued");
  if (s.state !== "RUNNING")
    return t("sync.indexed", { indexed: num(s.indexedCount), total: num(s.productCount) });
  const phase =
    s.phase === "fetch"
      ? t("sync.phase.fetch")
      : s.phase === "index"
        ? t(s.running?.type === "REINDEX" ? "sync.phase.rebuild" : "sync.phase.save")
        : s.phase === "finalize"
          ? t("sync.phase.finalize")
          : t("sync.phase.prepare");
  return `${phase} · ${t("sync.overall", { pct: s.percent })}`;
}

/** Chi tiết một bước: "34,649/34,649" sản phẩm, "61,200 variants", "12,000/34,649" đã lưu. */
export function syncStepDetail(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  step: NonNullable<SyncStatus["steps"]>[number],
  locale: string,
): string {
  const num = (n: number) => n.toLocaleString(locale);
  if (step.n === undefined) return "";
  if (step.total !== undefined) return `${num(step.n)}/${num(step.total)}`;
  return step.key === "variants" ? t("sync.step.variantsCount", { n: num(step.n) }) : num(step.n);
}
