import type { BulkKind, SyncProgress } from "./progress";

// Danh sách bước hiển thị dưới thanh tiến độ trang Sync, suy ra từ Shop.syncProgress + loại job.
// Full sync: tải sản phẩm / biến thể & giá / collection (song song) → lưu vào chỉ mục → chuyển sang dữ liệu mới.
// Reindex: dựng lại chỉ mục từ dữ liệu đang có (không gọi Shopify) → chuyển sang chỉ mục mới.

export type SyncStepKey = BulkKind | "save" | "rebuild" | "live";
export type SyncStep = {
  key: SyncStepKey;
  state: "done" | "active" | "waiting";
  /** Số đã xử lý (sản phẩm, biến thể, sản phẩm đã lưu). */
  n?: number;
  /** Tổng để hiện "n/total" (sản phẩm). */
  total?: number;
};

const ORDER: SyncProgress["phase"][] = ["prepare", "fetch", "index", "finalize"];

export function syncSteps(
  p: SyncProgress,
  jobType: string | undefined,
  counts: { indexed: number; total: number },
): SyncStep[] {
  const at = ORDER.indexOf(p.phase);
  const stage = (phase: SyncProgress["phase"]): SyncStep["state"] => {
    const i = ORDER.indexOf(phase);
    return at > i ? "done" : at === i ? "active" : "waiting";
  };
  const save = stage("index");
  const counted = save === "active" ? { n: counts.indexed, total: counts.total } : {};
  if (jobType === "REINDEX")
    return [
      { key: "rebuild", state: save, ...counted },
      { key: "live", state: stage("finalize") },
    ];

  const download = (key: BulkKind): SyncStep => {
    const b = p.bulks?.[key];
    const state = at > 1 || b?.done ? "done" : stage("fetch");
    return { key, state };
  };
  const products = download("products");
  const variants = download("variants");
  const fetched = p.bulks?.products?.n;
  const variantCount = p.bulks?.variants?.n;
  return [
    {
      ...products,
      ...(fetched !== undefined
        ? { n: Math.min(counts.total, fetched), total: counts.total }
        : products.state === "done"
          ? { n: counts.total, total: counts.total }
          : {}),
    },
    { ...variants, ...(variantCount && variants.state !== "done" ? { n: variantCount } : {}) },
    download("collections"),
    { key: "save", state: save, ...counted },
    { key: "live", state: stage("finalize") },
  ];
}
