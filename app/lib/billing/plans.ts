// Gói theo số sản phẩm (D12, mặc định đã chốt ở Nhật ký): Free < 100 · $9 (1k) · $19 (5k) · $49 (30k) · $99 (100k) · $199 (300k).
// Headless API (dùng ngoài theme) mở từ gói $49.

/** id = handle gói ở Partner Dashboard (Shopify App Pricing). Back-office (8.1) có thể thêm gói mới. */
export type PlanId = string;

export type Plan = {
  id: PlanId;
  /** Tên hiển thị — nên khớp tên gói khai ở Partner Dashboard. */
  name: string;
  /** Chỉ để hiển thị và ước tính MRR; giá thật đặt ở Partner Dashboard. */
  priceUsd: number;
  maxProducts: number;
  headless: boolean;
  /** AI search (hybrid embedding, task 5.1) — tốn CPU engine nên mở từ gói Pro. */
  semantic: boolean;
  /** Request/phút cho search-api theo shop (mùa cao điểm có thể tăng qua env). */
  rpm: number;
  /** Hiện ở trang Plans của merchant (gói cũ còn shop dùng thì ẩn đi, không xoá). */
  visible: boolean;
  position: number;
};

/** Gói mặc định: khởi tạo bảng PlanConfig lần đầu và dự phòng khi chưa nạp được DB. */
export const DEFAULT_PLANS: Plan[] = (
  [
    ["free", "Free", 0, 99, false, false, 600],
    ["starter", "Starter", 9, 1_000, false, false, 3_000],
    ["growth", "Growth", 19, 5_000, false, false, 6_000],
    ["pro", "Pro", 49, 30_000, true, true, 15_000],
    ["scale", "Scale", 99, 100_000, true, true, 30_000],
    ["enterprise", "Enterprise", 199, 300_000, true, true, 60_000],
  ] as const
).map(([id, name, priceUsd, maxProducts, headless, semantic, rpm], position) => ({
  id,
  name,
  priceUsd,
  maxProducts,
  headless,
  semantic,
  rpm,
  visible: true,
  position,
}));

// Registry trong tiến trình: plans-registry.server.ts nạp từ DB và làm mới định kỳ; hàm ở đây đọc đồng bộ.
let registry: Plan[] = DEFAULT_PLANS;

/** Mọi gói (kể cả ẩn), theo thứ tự hiển thị. */
export function plans(): Plan[] {
  return registry;
}

export function setPlans(list: Plan[]) {
  registry = list.length ? [...list].sort((a, b) => a.position - b.position) : DEFAULT_PLANS;
}

export function planById(id: string | null | undefined): Plan {
  return registry.find((p) => p.id === id) ?? registry.find((p) => p.id === "free") ?? registry[0];
}

/** Handle gói từ Partner API → gói đã khai trong back-office (không phân biệt hoa thường). */
export function planIdFromList(handles: string[]): PlanId | null {
  for (const h of handles) {
    const p = registry.find((x) => x.id === h.toLowerCase());
    if (p) return p.id;
  }
  return null;
}

/** Gói hiển thị nhỏ nhất chứa được catalog. */
export function planForProductCount(count: number): Plan {
  const visible = registry.filter((p) => p.visible).sort((a, b) => a.maxProducts - b.maxProducts);
  return visible.find((p) => count <= p.maxProducts) ?? visible[visible.length - 1] ?? registry[0];
}

/** Ghi đè theo shop do back-office đặt (nằm trong Shop.features). */
export type PlanOverrides = {
  /** Cấp AI search ngoài gói (hỗ trợ/đối tác). */
  semantic?: boolean;
  /** Cấp quyền headless ngoài gói (hỗ trợ/đối tác). */
  headless?: boolean;
  /** Gói tặng (dùng quyền lợi của gói này thay cho gói đang trả) tới `compUntil` (ISO; trống = không hạn). */
  compPlan?: string;
  compUntil?: string;
  maxProducts?: number;
  rpm?: number;
  /** Khoá: search-api trả 403, storefront về kết quả gốc của theme. */
  blocked?: boolean;
  blockedReason?: string;
};

export type Entitlements = {
  planId: PlanId;
  comped: boolean;
  maxProducts: number;
  rpm: number;
  headless: boolean;
  semantic: boolean;
  blocked: boolean;
};

/** Quyền lợi hiệu lực: gói tặng còn hạn (nếu có) hoặc gói đang trả, cộng ghi đè theo shop. */
export function entitlements(
  shop: { plan: string | null | undefined; features?: unknown },
  now = new Date(),
): Entitlements {
  const f = (shop.features ?? {}) as PlanOverrides;
  const comp =
    f.compPlan && (!f.compUntil || Date.parse(f.compUntil) > now.getTime()) ? f.compPlan : null;
  const base = planById(comp ?? shop.plan);
  return {
    planId: base.id,
    comped: Boolean(comp) && base.id === comp,
    maxProducts: f.maxProducts ?? base.maxProducts,
    rpm: f.rpm ?? base.rpm,
    headless: Boolean(f.headless) || base.headless,
    semantic: Boolean(f.semantic) || base.semantic,
    blocked: Boolean(f.blocked),
  };
}

export function headlessAllowed(planId: string | null | undefined, features?: PlanOverrides) {
  return entitlements({ plan: planId, features }).headless;
}

export function semanticAllowed(planId: string | null | undefined, features?: PlanOverrides) {
  return entitlements({ plan: planId, features }).semantic;
}

export type HeadlessDecision = "ok" | "not_in_plan" | "disabled" | "origin_not_allowed";

/**
 * Gọi API ngoài storefront của shop (headless) cần: gói cho phép + merchant đã bật ở trang Developers + (nếu có
 * danh sách) origin trình duyệt nằm trong danh sách. Gọi server-to-server (không có Origin) chỉ cần hai điều đầu.
 */
export function headlessDecision(
  planId: string | null | undefined,
  features: (PlanOverrides & { headlessEnabled?: boolean; headlessOrigins?: string[] }) | undefined,
  origin: string | null | undefined,
): HeadlessDecision {
  if (!headlessAllowed(planId, features)) return "not_in_plan";
  if (!features?.headlessEnabled) return "disabled";
  const allow = features.headlessOrigins ?? [];
  if (origin && allow.length && !allow.includes(origin.toLowerCase().replace(/\/$/, "")))
    return "origin_not_allowed";
  return "ok";
}
