import { Redis, type RedisOptions } from "ioredis";
import { env } from "./env.server";

// Redis dùng chung (queue, cache config, debounce, lock). Key luôn có prefix (REDIS_PREFIX) vì dev dùng chung
// container Redis với dự án khác.

let client: Redis | undefined;

export function createRedis(opts: RedisOptions = {}): Redis {
  // maxRetriesPerRequest: null là yêu cầu của BullMQ cho connection dùng chung.
  return new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...opts,
  });
}

export function redis(): Redis {
  client ??= createRedis();
  return client;
}

export function rkey(...parts: (string | number)[]): string {
  return [env().REDIS_PREFIX, ...parts].join(":");
}

/** Khoá đơn giản (SET NX PX). Trả về hàm nhả khoá hoặc null nếu đang bị giữ. */
export async function acquireLock(
  r: Redis,
  name: string,
  ttlMs: number,
): Promise<(() => Promise<void>) | null> {
  const token = Math.random().toString(36).slice(2);
  const ok = await r.set(name, token, "PX", ttlMs, "NX");
  if (!ok) return null;
  return async () => {
    // Chỉ xoá nếu vẫn là khoá của mình.
    await r.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      name,
      token,
    );
  };
}

export async function closeRedis() {
  await client?.quit().catch(() => undefined);
  client = undefined;
}
