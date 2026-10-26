import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import { env } from "../../../app/lib/env.server";
import { createRedis } from "../../../app/lib/redis.server";
import { engineForShop, sharedSearchEngine } from "../../../app/lib/search-service/engines.server";
import { createSearchApi } from "./app";

function withConnectionLimit(url: string, n: number): string {
  const u = new URL(url);
  if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", String(n));
  return u.toString();
}

// Process search-api (D9): `npm run search-api`. Không cần admin key của Typesense ở đây.
const e = env();
const redis = createRedis({ maxRetriesPerRequest: 1, enableOfflineQueue: false });
redis.on("error", () => undefined); // Redis lỗi → rate limit/analytics fallback, search vẫn chạy.

const app = createSearchApi({
  // search-api chỉ chạm Postgres khi dựng ngữ cảnh shop (đã cache + single-flight) → pool nhỏ để N replica
  // không vượt max_connections của Postgres (load test 6.2).
  db: new PrismaClient({ datasourceUrl: withConnectionLimit(e.DATABASE_URL, 5) }),
  redis,
  engineFor: engineForShop,
  defaultEngine: sharedSearchEngine(),
  internalSecret: e.INTERNAL_API_SECRET,
  redisPrefix: e.REDIS_PREFIX,
  ipRpm: Number(process.env.SEARCH_API_IP_RPM ?? 600),
  metricsToken: e.METRICS_TOKEN,
  // Mùa cao điểm (Black Friday): tăng hạn mức theo gói mà không đổi code — docs/ops/load-and-ha.md.
  shopRpmMultiplier: Number(process.env.SEARCH_API_SHOP_RPM_MULTIPLIER ?? 1),
});

serve({ fetch: app.fetch, port: e.SEARCH_API_PORT }, (info) =>
  console.log(`[search-api] listening on :${info.port}`),
);
