import { refreshPlans } from "./billing/plans-registry.server";
import prisma from "../db.server";
import { localeFromRequest } from "../i18n";
import { authenticate } from "../shopify.server";
import { onShopAuthenticated } from "./shop/install.server";
import { getShopByDomain } from "./shop/shop.server";
import { enqueueSync } from "./queue/queue.server";
import { adminContextTransport, GraphqlExecutor } from "./shopify/graphql";

export type AdminAuth = Awaited<ReturnType<typeof authenticate.admin>>;

// Ngữ cảnh chung cho route admin: Shop, locale UI. Route PHẢI tự `await authenticate.admin(request)` rồi truyền kết
// quả vào (rào xác thực hiện rõ trong từng loader/action — Shopify app security check UNAUTHENTICATED_ENDPOINT).
export async function adminContext(request: Request, auth: AdminAuth) {
  const { session, admin, redirect } = auth;
  // Gói/quyền lợi do back-office quản lý (8.1) — làm mới registry (tối đa mỗi 30 s).
  await refreshPlans(prisma);
  let shop = await getShopByDomain(prisma, session.shop);
  if (!shop) {
    // afterAuth chưa chạy (vd. cài qua managed install trước khi hook có mặt) → tạo ngay.
    shop = (
      await onShopAuthenticated(session.shop, {
        db: prisma,
        ex: new GraphqlExecutor(adminContextTransport(admin)),
        apiUrl: process.env.SEARCH_API_PUBLIC_URL,
        enqueueFullSync: (shopId, reason) =>
          enqueueSync({ type: "full", shopId, reason }, { jobId: `full-${shopId}-${Date.now()}` }),
      })
    ).shop;
  }
  return { session, admin, redirect, shop, locale: localeFromRequest(request), db: prisma };
}
