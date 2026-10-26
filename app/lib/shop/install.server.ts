import { GraphqlExecutor } from "../shopify/graphql";
import { SHOP_INFO_QUERY } from "../sync/queries";
import { ensureShop, type Db } from "./shop.server";

// Sau OAuth (managed install / token exchange): tạo hoặc kích hoạt lại Shop, rồi xếp full sync nếu cần.
// Không đăng ký webhook ở đây — webhook khai trong shopify.app.toml (README template).

type ShopInfo = {
  shop: {
    id: string;
    currencyCode: string;
    myshopifyDomain: string;
    primaryDomain?: { host: string } | null;
  };
  shopLocales: { locale: string; primary: boolean; published: boolean }[];
};

export async function fetchShopInfo(ex: GraphqlExecutor) {
  const d = await ex.query<ShopInfo>(SHOP_INFO_QUERY);
  const published = d.shopLocales.filter((l) => l.published);
  return {
    domains: [d.shop.myshopifyDomain, d.shop.primaryDomain?.host].filter((h): h is string =>
      Boolean(h),
    ),
    gid: d.shop.id,
    currency: d.shop.currencyCode,
    primaryLocale: published.find((l) => l.primary)?.locale ?? "en",
    locales: published.map((l) => l.locale),
  };
}

export const APP_INSTALLATION_QUERY = `query CurrentAppInstallation { currentAppInstallation { id } }`;
export const SET_APP_METAFIELDS_MUTATION = `mutation SetAppConfigMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key }
    userErrors { field message code }
  }
}`;

/**
 * App-data metafield (chỉ app đọc/ghi) → Liquid của app embed đọc qua `app.metafields.searchapp.*`
 * để gọi thẳng search-api (chế độ "direct"). Chế độ mặc định app proxy không cần public key.
 */
export async function setAppConfigMetafields(
  ex: GraphqlExecutor,
  cfg: { publicKey: string; apiUrl: string },
) {
  const inst = await ex.query<{ currentAppInstallation: { id: string } }>(APP_INSTALLATION_QUERY);
  const ownerId = inst.currentAppInstallation.id;
  const d = await ex.query<{
    metafieldsSet: { userErrors: { field: string[] | null; message: string }[] };
  }>(SET_APP_METAFIELDS_MUTATION, {
    metafields: [
      {
        ownerId,
        namespace: "searchapp",
        key: "public_key",
        type: "single_line_text_field",
        value: cfg.publicKey,
      },
      {
        ownerId,
        namespace: "searchapp",
        key: "api_url",
        type: "single_line_text_field",
        value: cfg.apiUrl,
      },
    ],
  });
  GraphqlExecutor.assertNoUserErrors(d.metafieldsSet.userErrors, "metafieldsSet");
}

export const WEB_PIXEL_CREATE = `mutation WebPixelCreate($webPixel: WebPixelInput!) {
  webPixelCreate(webPixel: $webPixel) {
    webPixel { id settings }
    userErrors { field message code }
  }
}`;
export const WEB_PIXEL_QUERY = `query WebPixel { webPixel { id settings } }`;
export const WEB_PIXEL_UPDATE = `mutation WebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
  webPixelUpdate(id: $id, webPixel: $webPixel) {
    webPixel { id settings }
    userErrors { field message code }
  }
}`;

/** Kích hoạt web pixel của app (mục 7.3) với settings khớp extensions/search-pixel/shopify.extension.toml. */
export async function ensureWebPixel(
  ex: GraphqlExecutor,
  settings: { shop: string; apiUrl: string; publicKey: string },
) {
  type R = {
    webPixelCreate: {
      webPixel: { id: string } | null;
      userErrors: { message: string; code: string | null }[];
    };
  };
  const created = await ex.query<R>(WEB_PIXEL_CREATE, { webPixel: { settings } });
  if (created.webPixelCreate.webPixel) return created.webPixelCreate.webPixel.id;
  // Đã có pixel (cài lại) → cập nhật settings.
  const cur = await ex
    .query<{ webPixel: { id: string } | null }>(WEB_PIXEL_QUERY)
    .catch(() => ({ webPixel: null }));
  if (!cur.webPixel)
    GraphqlExecutor.assertNoUserErrors(created.webPixelCreate.userErrors, "webPixelCreate");
  type U = { webPixelUpdate: { userErrors: { message: string }[] } };
  const upd = await ex.query<U>(WEB_PIXEL_UPDATE, { id: cur.webPixel!.id, webPixel: { settings } });
  GraphqlExecutor.assertNoUserErrors(upd.webPixelUpdate.userErrors, "webPixelUpdate");
  return cur.webPixel!.id;
}

export type InstallDeps = {
  db: Db;
  ex: GraphqlExecutor;
  enqueueFullSync: (shopId: string, reason: string) => Promise<void>;
  /** URL công khai của search-api (chế độ direct). */
  apiUrl?: string;
};

export async function onShopAuthenticated(domain: string, deps: InstallDeps) {
  const info = await fetchShopInfo(deps.ex);
  const { shop, created, reinstalled } = await ensureShop(deps.db, domain, info);
  if ((created || reinstalled) && deps.apiUrl) {
    // Không chặn cài đặt nếu ghi metafield lỗi; app proxy vẫn hoạt động.
    await setAppConfigMetafields(deps.ex, { publicKey: shop.publicKey, apiUrl: deps.apiUrl }).catch(
      (e) => console.warn("[install] metafieldsSet failed", e),
    );
    await ensureWebPixel(deps.ex, {
      shop: domain,
      apiUrl: deps.apiUrl,
      publicKey: shop.publicKey,
    }).catch((e) => console.warn("[install] webPixelCreate failed", e));
  }

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
