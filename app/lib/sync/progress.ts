// Tiến độ full sync / reindex cho trang Sync: một thanh chung chia theo giai đoạn, vì phần lớn thời gian là chờ
// Shopify chạy bulk (số sản phẩm đã index đứng yên ở 0 rồi nhảy lên 100% nếu chỉ dựa vào nó).
//   prepare 0–5 · fetch 5–70 (bulk xong / tổng bulk) · index 70–98 (đã ghi / tổng) · finalize 98–100 (swap alias)

export type SyncPhase = "prepare" | "fetch" | "index" | "finalize";
export type SyncProgress = { phase: SyncPhase; percent: number; fetched?: number };

export const fetchPercent = (done: number, total: number) => 5 + 65 * (total ? done / total : 1);

export const indexPercent = (n: number, total: number, from = 70, to = 98) =>
  from + (to - from) * (total ? Math.min(1, n / total) : 1);

/** Ghi tiến độ: tối đa một lần mỗi `minMs` trong cùng phase, đổi phase thì ghi ngay; phần trăm không lùi. */
export function progressReporter(
  write: (p: SyncProgress) => Promise<unknown>,
  now: () => number,
  minMs = 1000,
) {
  let last = -Infinity;
  let phase: SyncPhase | null = null;
  let high = 0;
  return (p: SyncProgress) => {
    const t = now();
    if (p.phase === phase && t - last < minMs) return;
    last = t;
    phase = p.phase;
    high = Math.max(high, Math.min(100, Math.round(p.percent)));
    void write({ ...p, percent: high }).catch(() => undefined);
  };
}
