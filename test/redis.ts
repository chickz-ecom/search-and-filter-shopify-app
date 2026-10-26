import { Redis } from "ioredis";

// Redis cho integration test: DB riêng (REDIS_URL trong .env.test → /6), prefix sa_test.
let client: Redis | undefined;

export function testRedis(): Redis {
  if (!process.env.REDIS_URL?.endsWith("/6"))
    throw new Error("Refusing to use a non-test Redis DB");
  client ??= new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  return client;
}

export async function flushTestPrefix() {
  const r = testRedis();
  const keys = await r.keys(`${process.env.REDIS_PREFIX ?? "sa_test"}:*`);
  if (keys.length) await r.del(...keys);
}
