import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { enqueueSync } from "./lib/queue/queue.server";
import { onShopAuthenticated } from "./lib/shop/install.server";
import { adminContextTransport, GraphqlExecutor } from "./lib/shopify/graphql";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    // Chạy sau OAuth/token exchange: tạo Shop + seed cấu hình + xếp full sync lần đầu.
    afterAuth: async ({ session, admin }) => {
      await onShopAuthenticated(session.shop, {
        db: prisma,
        ex: new GraphqlExecutor(adminContextTransport(admin)),
        enqueueFullSync: (shopId, reason) =>
          enqueueSync({ type: "full", shopId, reason }, { jobId: `full-${shopId}-${Date.now()}` }),
      });
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
