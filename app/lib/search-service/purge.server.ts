import { env } from "../env.server";
import { pushMerchToEngine } from "../merch/engine-sync.server";
import { redis } from "../redis.server";
import { getEngine } from "../search";
import type { Db } from "../shop/shop.server";
import { purgeShopConfig } from "./context.server";

// Sau mỗi lần merchant lưu (mục 9): ghi Postgres → đẩy merch sang engine → purge cache config (Redis + micro-cache
// của search-api) → purge CDN theo tag `shop-{domain}`. Mục tiêu DoD 3.3: storefront đổi ≤ 1 phút.

export type PurgeOptions = { merch?: boolean };

export async function afterConfigSaved(
  db: Db,
  shop: { id: string; domain: string },
  opts: PurgeOptions = {},
) {
  if (opts.merch) await pushMerchToEngine(db, getEngine(), shop.id);
  await purgeShopConfig(shop.domain, redis());
  const e = env();
  // Micro-cache trong process search-api (≤ 10 s) — gọi purge nội bộ; lỗi không chặn việc lưu.
  if (e.INTERNAL_API_SECRET && e.SEARCH_API_PUBLIC_URL) {
    await fetch(new URL("/internal/purge", e.SEARCH_API_PUBLIC_URL), {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": e.INTERNAL_API_SECRET },
      body: JSON.stringify({ shop: shop.domain }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => undefined);
  }
  await purgeCdn(shop.domain).catch(() => undefined);
}

/**
 * Purge CDN theo tag. Cloudflare: POST /zones/{zone}/purge_cache { tags: [...] } (cần CDN_PURGE_URL + CDN_PURGE_TOKEN).
 * Không cấu hình → bỏ qua (Cache-Control max-age=30 tự hết hạn). Cấu hình thật → HUMAN_TODO E2.
 */
export async function purgeCdn(domain: string) {
  const url = process.env.CDN_PURGE_URL;
  const token = process.env.CDN_PURGE_TOKEN;
  if (!url || !token) return;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ tags: [`shop-${domain}`] }),
    signal: AbortSignal.timeout(3000),
  });
}
