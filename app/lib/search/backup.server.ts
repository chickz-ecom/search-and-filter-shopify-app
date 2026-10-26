import type { SearchEngine } from "./engine";

// Backup Typesense (task 6.2): snapshot hằng đêm vào <dir>/<YYYY-MM-DD> trên máy engine. Index dựng lại được từ
// Shopify (full sync), nên snapshot chỉ để khôi phục NHANH (RTO phút thay vì giờ) — docs/ops/load-and-ha.md.
export async function snapshotEngine(engine: SearchEngine, dir: string, now = new Date()) {
  if (!dir) return { skipped: "TYPESENSE_SNAPSHOT_DIR not set" };
  if (!engine.snapshot) return { skipped: "engine has no snapshot support" };
  const path = `${dir.replace(/\/$/, "")}/${now.toISOString().slice(0, 10)}`;
  await engine.snapshot(path);
  return { path };
}
