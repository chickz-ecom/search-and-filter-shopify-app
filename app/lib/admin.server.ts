import prisma from "../db.server";
import { localeFromRequest } from "../i18n";
import { authenticate } from "../shopify.server";
import { onShopAuthenticated } from "./shop/install.server";
import { getShopByDomain } from "./shop/shop.server";
import { enqueueSync } from "./queue/queue.server";
import { adminContextTransport, GraphqlExecutor } from "./shopify/graphql";

// Ngữ cảnh chung cho route admin: xác thực (token exchange), Shop, locale UI.
export async function adminContext(request: Request) {
  const { session, admin, redirect } = await authenticate.admin(request);
  let shop = await getShopByDomain(prisma, session.shop);
  if (!shop) {
    // afterAuth chưa chạy (vd. cài qua managed install trước khi hook có mặt) → tạo ngay.
    shop = (
      await onShopAuthenticated(session.shop, {
        db: prisma,
        ex: new GraphqlExecutor(adminContextTransport(admin)),
        enqueueFullSync: (shopId, reason) =>
          enqueueSync({ type: "full", shopId, reason }, { jobId: `full-${shopId}-${Date.now()}` }),
      })
    ).shop;
  }
  return { session, admin, redirect, shop, locale: localeFromRequest(request), db: prisma };
}
