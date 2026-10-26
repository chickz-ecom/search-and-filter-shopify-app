import type { Redis } from "ioredis";
import prisma from "../app/db.server";
import { bulkChannel } from "../app/lib/queue/queue.server";
import { createRedis, redis } from "../app/lib/redis.server";
import { getEngine } from "../app/lib/search";
import {
  adminContextTransport,
  executorFor,
  type GraphqlExecutor,
} from "../app/lib/shopify/graphql";
import { BulkRunner, type BulkNotifier } from "../app/lib/sync/bulk-runner";
import { unauthenticated } from "../app/shopify.server";

// Phụ thuộc dùng chung của worker. Executor theo shop: transport gọi unauthenticated.admin mỗi lần để
// thư viện tự refresh expiring offline token (60 phút).

export function shopExecutor(domain: string): GraphqlExecutor {
  return executorFor(domain, () => async (query, variables) => {
    const { admin } = await unauthenticated.admin(domain);
    return adminContextTransport(admin)(query, variables);
  });
}

/** Webhook bulk_operations/finish publish vào kênh → BulkRunner thôi chờ poll. */
class RedisBulkNotifier implements BulkNotifier {
  private sub: Redis | undefined;
  private waiters = new Map<string, Set<() => void>>();

  private ensure() {
    if (this.sub) return;
    this.sub = createRedis();
    this.sub.on("pmessage", (_p, channel) => {
      for (const [id, set] of this.waiters) {
        if (channel === bulkChannel(id)) for (const fn of set) fn();
      }
    });
    void this.sub.psubscribe(bulkChannel("*"));
  }

  wait(bulkId: string, timeoutMs: number): Promise<void> {
    this.ensure();
    return new Promise((resolve) => {
      const set = this.waiters.get(bulkId) ?? new Set();
      this.waiters.set(bulkId, set);
      const done = () => {
        clearTimeout(t);
        set.delete(done);
        if (!set.size) this.waiters.delete(bulkId);
        resolve();
      };
      const t = setTimeout(done, timeoutMs);
      set.add(done);
    });
  }

  async close() {
    await this.sub?.quit().catch(() => undefined);
  }
}

export const notifier = new RedisBulkNotifier();

export function workerDeps(domain: string) {
  const ex = shopExecutor(domain);
  return {
    db: prisma,
    engine: getEngine(),
    ex,
    runner: new BulkRunner(ex, { notifier }),
    redis: redis(),
  };
}

export { prisma };
