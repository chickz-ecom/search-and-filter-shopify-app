import type { GraphqlExecutor } from "../shopify/graphql";
import { SHOP_INFO_QUERY } from "../sync/queries";
import { ensureShop, type Db } from "./shop.server";

// Sau OAuth (managed install / token exchange): tạo hoặc kích hoạt lại Shop, rồi xếp full sync nếu cần.
// Không đăng ký webhook ở đây — webhook khai trong shopify.app.toml (README template).

type ShopInfo = {
  shop: { currencyCode: string; myshopifyDomain: string; primaryDomain?: { host: string } | null };
  shopLocales: { locale: string; primary: boolean; published: boolean }[];
};

export async function fetchShopInfo(ex: GraphqlExecutor) {
  const d = await ex.query<ShopInfo>(SHOP_INFO_QUERY);
  const published = d.shopLocales.filter((l) => l.published);
  return {
    domains: [d.shop.myshopifyDomain, d.shop.primaryDomain?.host].filter((h): h is string =>
      Boolean(h),
    ),
    currency: d.shop.currencyCode,
    primaryLocale: published.find((l) => l.primary)?.locale ?? "en",
    locales: published.map((l) => l.locale),
  };
}

export type InstallDeps = {
  db: Db;
  ex: GraphqlExecutor;
  enqueueFullSync: (shopId: string, reason: string) => Promise<void>;
};

export async function onShopAuthenticated(domain: string, deps: InstallDeps) {
  const info = await fetchShopInfo(deps.ex);
  const { shop, created, reinstalled } = await ensureShop(deps.db, domain, info);
  const needsSync =
    created ||
    reinstalled ||
    (!shop.lastFullSyncAt && shop.syncState !== "RUNNING" && shop.syncState !== "QUEUED");
  if (needsSync) {
    await deps.db.shop.update({ where: { id: shop.id }, data: { syncState: "QUEUED" } });
    await deps.enqueueFullSync(
      shop.id,
      created ? "install" : reinstalled ? "reinstall" : "initial",
    );
  }
  return { shop, created, reinstalled, enqueued: needsSync };
}
