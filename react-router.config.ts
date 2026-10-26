import type { Config } from "@react-router/dev/config";
import { allowedActionOrigins } from "./app/lib/action-origins";

// SHOPIFY_APP_URL do `shopify app dev` đặt (tunnel) hoặc env lúc build production.
export default {
  allowedActionOrigins: allowedActionOrigins(process.env.SHOPIFY_APP_URL),
} satisfies Config;
