// Gói theo số sản phẩm (D12, mặc định đã chốt ở Nhật ký): Free < 100 · $9 (1k) · $19 (5k) · $49 (30k) · $99 (100k) · $199 (300k).
// Headless API (dùng ngoài theme) mở từ gói $49.

export type PlanId = "free" | "starter" | "growth" | "pro" | "scale" | "enterprise";

export type Plan = {
  id: PlanId;
  /** Tên hiển thị trong Shopify App Pricing (managed pricing) — phải khớp tên gói khai ở Partner Dashboard. */
  name: string;
  priceUsd: number;
  maxProducts: number;
  headless: boolean;
  /** Request/phút cho search-api theo shop (mùa cao điểm có thể tăng qua env). */
  rpm: number;
};

export const PLANS: Plan[] = [
  { id: "free", name: "Free", priceUsd: 0, maxProducts: 99, headless: false, rpm: 600 },
  { id: "starter", name: "Starter", priceUsd: 9, maxProducts: 1_000, headless: false, rpm: 3_000 },
  { id: "growth", name: "Growth", priceUsd: 19, maxProducts: 5_000, headless: false, rpm: 6_000 },
  { id: "pro", name: "Pro", priceUsd: 49, maxProducts: 30_000, headless: true, rpm: 15_000 },
  { id: "scale", name: "Scale", priceUsd: 99, maxProducts: 100_000, headless: true, rpm: 30_000 },
  {
    id: "enterprise",
    name: "Enterprise",
    priceUsd: 199,
    maxProducts: 300_000,
    headless: true,
    rpm: 60_000,
  },
];

export function planById(id: string | null | undefined): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

/** Gói nhỏ nhất chứa được catalog. */
export function planForProductCount(count: number): Plan {
  return PLANS.find((p) => count <= p.maxProducts) ?? PLANS[PLANS.length - 1];
}

export function headlessAllowed(
  planId: string | null | undefined,
  features?: { headless?: boolean },
): boolean {
  return Boolean(features?.headless) || planById(planId).headless;
}

export type HeadlessDecision = "ok" | "not_in_plan" | "disabled" | "origin_not_allowed";

/**
 * Gọi API ngoài storefront của shop (headless) cần: gói cho phép + merchant đã bật ở trang Developers + (nếu có
 * danh sách) origin trình duyệt nằm trong danh sách. Gọi server-to-server (không có Origin) chỉ cần hai điều đầu.
 */
export function headlessDecision(
  planId: string | null | undefined,
  features:
    { headless?: boolean; headlessEnabled?: boolean; headlessOrigins?: string[] } | undefined,
  origin: string | null | undefined,
): HeadlessDecision {
  if (!headlessAllowed(planId, features)) return "not_in_plan";
  if (!features?.headlessEnabled) return "disabled";
  const allow = features.headlessOrigins ?? [];
  if (origin && allow.length && !allow.includes(origin.toLowerCase().replace(/\/$/, "")))
    return "origin_not_allowed";
  return "ok";
}
