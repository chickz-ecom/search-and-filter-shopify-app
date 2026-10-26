// Khôi phục thảm hoạ (task 6.2): xếp full sync cho mọi shop đang cài — dựng lại toàn bộ index từ Shopify khi mất
// cluster Typesense mà không có snapshot dùng được. Worker xử lý theo WORKER_CONCURRENCY (Shopify bulk song song).
//   npx tsx scripts/reindex-all.ts [--dry-run]
import { PrismaClient } from "@prisma/client";
import { closeQueues, enqueueSync } from "../app/lib/queue/queue.server";

const dry = process.argv.includes("--dry-run");
const db = new PrismaClient();
const shops = await db.shop.findMany({
  where: { uninstalledAt: null },
  select: { id: true, domain: true },
  orderBy: { productCount: "asc" },
});
console.log(`${shops.length} shops${dry ? " (dry run)" : ""}`);
for (const s of shops) {
  if (dry) continue;
  // Shop nhỏ trước: phần lớn storefront có lại kết quả sớm nhất.
  await db.shop.update({ where: { id: s.id }, data: { syncState: "QUEUED" } });
  await enqueueSync(
    { type: "full", shopId: s.id, reason: "disaster-recovery" },
    { jobId: `full-${s.id}-dr-${Date.now()}` },
  );
}
await closeQueues();
await db.$disconnect();
