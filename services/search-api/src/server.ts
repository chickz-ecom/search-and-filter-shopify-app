import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import { env } from "../../../app/lib/env.server";
import { createRedis } from "../../../app/lib/redis.server";
import { engineForShop, sharedSearchEngine } from "../../../app/lib/search-service/engines.server";
import { createSearchApi } from "./app";

// Process search-api (D9): `npm run search-api`. Không cần admin key của Typesense ở đây.
const e = env();
const redis = createRedis({ maxRetriesPerRequest: 1, enableOfflineQueue: false });
redis.on("error", () => undefined); // Redis lỗi → rate limit/analytics fallback, search vẫn chạy.

const app = createSearchApi({
  db: new PrismaClient(),
  redis,
  engineFor: engineForShop,
  defaultEngine: sharedSearchEngine(),
  internalSecret: e.INTERNAL_API_SECRET,
  redisPrefix: e.REDIS_PREFIX,
  ipRpm: Number(process.env.SEARCH_API_IP_RPM ?? 600),
});

serve({ fetch: app.fetch, port: e.SEARCH_API_PORT }, (info) =>
  console.log(`[search-api] listening on :${info.port}`),
);
