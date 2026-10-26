import type { Job } from "bullmq";
import type { MaintJobData, SyncJobData } from "../app/lib/queue/queue.server";
import { acquireLock, redis, rkey } from "../app/lib/redis.server";
import { runFullSync } from "../app/lib/sync/full-sync.server";
import { prisma, workerDeps } from "./context";

async function shopDomain(shopId: string): Promise<string | null> {
  const s = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { domain: true, uninstalledAt: true },
  });
  return s && !s.uninstalledAt ? s.domain : null;
}

export async function handleSyncJob(job: Job<SyncJobData>): Promise<unknown> {
  const data = job.data;
  switch (data.type) {
    case "full": {
      const domain = await shopDomain(data.shopId);
      if (!domain) return { skipped: "uninstalled" };
      // Một full sync mỗi shop tại một thời điểm.
      const release = await acquireLock(redis(), rkey("lock", "full", data.shopId), 6 * 3600_000);
      if (!release) return { skipped: "already-running" };
      try {
        return await runFullSync(data.shopId, workerDeps(domain), {
          reason: data.reason,
          syncJobId: data.syncJobId,
        });
      } finally {
        await release();
      }
    }
    default:
      return { skipped: `unhandled:${data.type}` };
  }
}

export async function handleMaintJob(job: Job<MaintJobData>): Promise<unknown> {
  return { skipped: `unhandled:${job.data.type}` };
}
