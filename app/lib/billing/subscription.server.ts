import { env } from "../env.server";
import { redis } from "../redis.server";
import { purgeShopConfig } from "../search-service/context.server";
import type { Db } from "../shop/shop.server";
import { PLANS, planById, type PlanId } from "./plans";

// Shopify App Pricing (task 3.9, D12). Shopify host trang chọn gói; app chỉ đọc gói hiện tại qua Partner API
// `activeSubscription` (App Pricing không gửi webhook billing và không dùng currentAppInstallation —
// docs/shopify-api/admin-graphql.md mục 12). Không cấu hình Partner API (dev) → dùng shop.plan đã lưu.

// Đã validate (api: partner, 2026-10): docs/shopify-api/admin/partner-active-subscription.graphql
export const ACTIVE_SUBSCRIPTION_QUERY = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    cancelAtEndOfCycle
    trialEndsAt
    legacySubscriptionId
    currentBillingCycle {
      startTime
      endTime
    }
    items {
      handle
      description
    }
    pendingUpdate {
      billingPeriod
      items {
        handle
      }
    }
  }
}`;

export type PartnerClient = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

type ActiveSubscription = {
  billingPeriod: string | null;
  cancelAtEndOfCycle: boolean | null;
  trialEndsAt: string | null;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: { handle: string; description: string | null }[];
  pendingUpdate: { billingPeriod: string | null; items: { handle: string }[] } | null;
} | null;

export type SubscriptionInfo = {
  planId: PlanId;
  source: "partner" | "local";
  billingPeriod: string | null;
  renewsAt: string | null;
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
  pendingPlanId: PlanId | null;
};

// VERIFY: endpoint Partner API https://partners.shopify.com/{org_id}/api/{version}/graphql.json — chuỗi URL bị
// lược khỏi kết quả docs; header X-Shopify-Access-Token đã xác nhận (shopify.dev/docs/api/partner). HUMAN_TODO J2.
export function partnerClientFromEnv(fetchImpl: typeof fetch = fetch): PartnerClient | null {
  const e = env();
  if (!e.SHOPIFY_PARTNER_ORG_ID || !e.SHOPIFY_PARTNER_API_TOKEN) return null;
  const url = `https://partners.shopify.com/${e.SHOPIFY_PARTNER_ORG_ID}/api/2026-10/graphql.json`;
  return async <T>(query: string, variables: Record<string, unknown>) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": e.SHOPIFY_PARTNER_API_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Partner API ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`Partner API: ${body.errors[0].message}`);
    return body.data as T;
  };
}

/** Handle gói khai ở Partner Dashboard phải trùng PlanId (HUMAN_TODO J1). */
export function planIdFromHandles(handles: string[]): PlanId | null {
  for (const h of handles) {
    const p = PLANS.find((x) => x.id === h.toLowerCase());
    if (p) return p.id;
  }
  return null;
}

// VERIFY: dạng URL trang chọn gói (docs dựng từ store handle + app handle; chuỗi mẫu bị lược) — HUMAN_TODO J3.
export function planSelectionUrl(shopDomain: string, appHandle = env().SHOPIFY_APP_HANDLE): string {
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${store}/charges/${appHandle}/pricing_plans`;
}

type ShopRow = { id: string; domain: string; plan: string; shopifyGid: string | null };

/** Đối chiếu gói với Partner API, cập nhật shop.plan nếu đổi (search-api đọc plan → purge cache ngữ cảnh). */
export async function refreshPlan(
  db: Db,
  shop: ShopRow,
  deps: {
    client?: PartnerClient | null;
    appGid?: string;
    now?: Date;
    purge?: (domain: string) => Promise<void>;
  } = {},
): Promise<SubscriptionInfo> {
  const client = deps.client === undefined ? partnerClientFromEnv() : deps.client;
  const appGid = deps.appGid ?? env().SHOPIFY_APP_GID;
  const local: SubscriptionInfo = {
    planId: planById(shop.plan).id,
    source: "local",
    billingPeriod: null,
    renewsAt: null,
    trialEndsAt: null,
    cancelAtEndOfCycle: false,
    pendingPlanId: null,
  };
  if (!client || !appGid || !shop.shopifyGid) return local;

  const d = await client<{ activeSubscription: ActiveSubscription }>(ACTIVE_SUBSCRIPTION_QUERY, {
    appId: appGid,
    shopId: shop.shopifyGid,
  });
  const sub = d.activeSubscription;
  // Không có hợp đồng → gói Free (không phải lỗi).
  const planId = sub ? (planIdFromHandles(sub.items.map((i) => i.handle)) ?? "free") : "free";
  const info: SubscriptionInfo = {
    planId,
    source: "partner",
    billingPeriod: sub?.billingPeriod ?? null,
    renewsAt: sub?.currentBillingCycle?.endTime ?? null,
    trialEndsAt: sub?.trialEndsAt ?? null,
    cancelAtEndOfCycle: Boolean(sub?.cancelAtEndOfCycle),
    pendingPlanId: sub?.pendingUpdate
      ? planIdFromHandles(sub.pendingUpdate.items.map((i) => i.handle))
      : null,
  };
  await db.shop.update({
    where: { id: shop.id },
    data: { plan: planId, planCheckedAt: deps.now ?? new Date() },
  });
  if (planId !== shop.plan) await (deps.purge ?? ((d) => purgeShopConfig(d, redis())))(shop.domain);
  return info;
}

/** Job đêm: App Pricing không có webhook → đối chiếu gói mọi shop đang cài (tuần tự, lỗi một shop không chặn). */
export async function refreshAllPlans(
  db: Db,
  client: PartnerClient | null = partnerClientFromEnv(),
) {
  if (!client || !env().SHOPIFY_APP_GID) return { skipped: "partner-api-not-configured" };
  const shops = await db.shop.findMany({
    where: { uninstalledAt: null, shopifyGid: { not: null } },
    select: { id: true, domain: true, plan: true, shopifyGid: true },
  });
  let changed = 0;
  let failed = 0;
  for (const s of shops) {
    try {
      if ((await refreshPlan(db, s, { client })).planId !== s.plan) changed++;
    } catch (e) {
      failed++;
      console.warn(`[billing] refresh ${s.domain} failed:`, (e as Error).message);
    }
  }
  return { shops: shops.length, changed, failed };
}
