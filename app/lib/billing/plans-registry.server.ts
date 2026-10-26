import type { Db } from "../shop/shop.server";
import { DEFAULT_PLANS, setPlans, type Plan } from "./plans";

// Back-office (8.1): nạp gói từ PlanConfig vào registry của tiến trình (app, search-api, worker). Làm mới tối đa mỗi
// 30 s; back-office gọi `force` ngay sau khi lưu. Bảng trống → khởi tạo bằng DEFAULT_PLANS (một lần).

const MAX_AGE_MS = 30_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

const toPlan = (r: {
  id: string;
  name: string;
  priceUsd: unknown;
  maxProducts: number;
  rpm: number;
  headless: boolean;
  semantic: boolean;
  visible: boolean;
  position: number;
}): Plan => ({ ...r, priceUsd: Number(r.priceUsd) });

export async function refreshPlans(db: Db, opts: { force?: boolean; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  if (!opts.force && now - loadedAt < MAX_AGE_MS) return;
  inflight ??= (async () => {
    try {
      let rows = await db.planConfig.findMany({ orderBy: { position: "asc" } });
      if (!rows.length) {
        await db.planConfig.createMany({ data: DEFAULT_PLANS, skipDuplicates: true });
        rows = await db.planConfig.findMany({ orderBy: { position: "asc" } });
      }
      setPlans(rows.map(toPlan));
      loadedAt = now;
    } catch (e) {
      // DB lỗi → giữ registry hiện có (lần đầu là DEFAULT_PLANS), thử lại ở lượt sau.
      console.warn("[plans] refresh failed", (e as Error).message);
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}
