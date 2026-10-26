import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { env } from "../lib/env.server";
import { redis } from "../lib/redis.server";
import { rewriteProxyRequest, TRUSTED_SHOP_HEADER } from "../lib/search-service/app-proxy.server";
import { engineForShop, sharedSearchEngine } from "../lib/search-service/engines.server";
import { createSearchApi } from "../../services/search-api/src/app";

// App proxy: https://{shop}/apps/search/v1/* → cùng search API, same-origin (không CORS, không cần publicKey).
let api: ReturnType<typeof createSearchApi> | undefined;
function searchApi() {
  api ??= createSearchApi({
    db: prisma,
    redis: redis(),
    engineFor: engineForShop,
    defaultEngine: sharedSearchEngine(),
    redisPrefix: env().REDIS_PREFIX,
    trustedShopHeader: TRUSTED_SHOP_HEADER,
  });
  return api;
}

async function handle(request: Request) {
  const rewritten = rewriteProxyRequest(request, env().SHOPIFY_API_SECRET);
  if (rewritten instanceof Response) return rewritten;
  return searchApi().fetch(rewritten);
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
export const action = ({ request }: ActionFunctionArgs) => handle(request);
