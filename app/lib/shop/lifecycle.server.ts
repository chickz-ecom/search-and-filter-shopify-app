import { purgeShopConfig } from "../search-service/context.server";
import { pruneOrderLines } from "../sync/order-ranking.server";
import type { Redis } from "ioredis";
import type { SearchEngine } from "../search/engine";
import {
  contentAlias,
  curationSetName,
  isShopResource,
  productAlias,
  stopwordsId,
  synonymSetName,
} from "../search/names";
import { rkey } from "../redis.server";
import type { Db } from "./shop.server";

// Vòng đời shop (task 1.10, mục 5.4).
// - app/uninstalled: session đã xoá ở webhook; ở đây dừng việc đang chờ, giữ index 48 giờ (cài lại không phải sync lại).
// - shop/redact (≈48h sau gỡ): xoá index + mọi dữ liệu của shop (BFS: "shop/redact xoá sạch").

export async function uninstallShop(shopId: string, deps: { db: Db; redis?: Redis }) {
  const shop = await deps.db.shop
    .update({ where: { id: shopId }, data: { syncState: "IDLE", uninstalledAt: new Date() } })
    .catch(() => null);
  // search-api ngừng phục vụ shop ngay (cache ngữ cảnh Redis 5 phút) — security check SESSION_LIFECYCLE.
  if (shop) await purgeShopConfig(shop.domain, deps.redis);
  await deps.db.syncJob.updateMany({
    where: { shopId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
  if (deps.redis) await deleteShopKeys(deps.redis, shopId, ["inc", "fullsync"]);
}

async function deleteShopKeys(r: Redis, shopId: string, namespaces?: string[]) {
  const patterns = namespaces
    ? namespaces.map((n) => rkey(n, shopId) + "*")
    : [rkey("*", shopId) + "*", rkey("*", "*", shopId) + "*"];
  for (const pattern of patterns) {
    let cursor = "0";
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", pattern, "COUNT", 500);
      cursor = next;
      if (keys.length) await r.del(...keys);
    } while (cursor !== "0");
  }
}

export async function deleteEngineResources(
  engine: SearchEngine,
  shopId: string,
  locales: string[] = [],
) {
  for (const prefix of [productAlias(shopId), contentAlias(shopId)]) {
    for (const c of await engine.listCollections(prefix))
      if (isShopResource(shopId, c)) await engine.dropCollection(c);
    await engine.deleteAlias(prefix);
  }
  await engine.deleteSynonymSet(synonymSetName(shopId));
  await engine.deleteCurationSet(curationSetName(shopId));
  for (const l of new Set(["en", ...locales])) await engine.deleteStopwords(stopwordsId(shopId, l));
}

export type RedactResult = { shopFound: boolean; deletedSessions: number };

export async function redactShop(
  shopDomain: string,
  deps: { db: Db; engine: SearchEngine; redis?: Redis },
): Promise<RedactResult> {
  const shop = await deps.db.shop.findUnique({ where: { domain: shopDomain } });
  const sessions = await deps.db.session.deleteMany({ where: { shop: shopDomain } });
  await deps.db.webhookReceipt.deleteMany({ where: { shopDomain } });
  if (!shop) return { shopFound: false, deletedSessions: sessions.count };
  const stopLocales = (
    await deps.db.stopWord.findMany({
      where: { shopId: shop.id },
      select: { locale: true },
      distinct: ["locale"],
    })
  ).map((s) => s.locale);
  await deleteEngineResources(deps.engine, shop.id, [...shop.locales, ...stopLocales]);
  if (deps.redis) await deleteShopKeys(deps.redis, shop.id);
  // Cascade: SyncJob, SearchSettings, SortOption/Default, FilterSet, merch, Appearance, Analytics*.
  await deps.db.shop.delete({ where: { id: shop.id } });
  return { shopFound: true, deletedSessions: sessions.count };
}

/** Lưu analytics tổng hợp (ẩn danh) tối đa 13 tháng — đủ so sánh cùng kỳ năm trước (chính sách quyền riêng tư). */
export const ANALYTICS_RETENTION_DAYS = 400;

/** Dọn định kỳ: receipt > 7 ngày; analytics > 13 tháng; shop gỡ > 7 ngày mà chưa nhận shop/redact (lưới an toàn). */
export async function cleanup(
  deps: { db: Db; engine: SearchEngine; redis?: Redis },
  now = new Date(),
) {
  const week = new Date(now.getTime() - 7 * 24 * 3600_000);
  const receipts = await deps.db.webhookReceipt.deleteMany({ where: { receivedAt: { lt: week } } });
  const retention = new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * 24 * 3600_000);
  const [daily, usage] = await Promise.all([
    deps.db.analyticsDaily.deleteMany({ where: { date: { lt: retention } } }),
    deps.db.analyticsUsageDaily.deleteMany({ where: { date: { lt: retention } } }),
  ]);
  const orderLines = await pruneOrderLines(deps.db, now);
  const stale = await deps.db.shop.findMany({
    where: { uninstalledAt: { lt: week } },
    select: { domain: true },
  });
  for (const s of stale) await redactShop(s.domain, deps);
  return {
    receipts: receipts.count,
    analyticsRows: daily.count + usage.count,
    orderLines: orderLines.deleted,
    redacted: stale.length,
  };
}
