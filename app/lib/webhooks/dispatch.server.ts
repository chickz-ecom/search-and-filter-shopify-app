import { Prisma } from "@prisma/client";
import type { JobsOptions } from "bullmq";
import { env } from "../env.server";
import {
  bulkChannel,
  enqueueIncremental,
  enqueueSync,
  type SyncJobData,
} from "../queue/queue.server";
import { redis } from "../redis.server";
import type { Db } from "../shop/shop.server";
import { eventActions, webhookActions, type WebhookAction } from "./actions";
import { readVerifiedWebhook, type VerifiedWebhook } from "./verify.server";

// Handler webhook: xác thực → dedupe → enqueue → 200 nhanh (CLAUDE.md, D7). Không gọi Shopify ở đây.

export type WebhookSink = {
  incremental(shopId: string, productIds: string[]): Promise<void>;
  sync(data: SyncJobData, opts?: JobsOptions): Promise<void>;
  bulkFinished(bulkId: string, status: string): Promise<void>;
};

export const defaultSink: WebhookSink = {
  incremental: (shopId, ids) => enqueueIncremental(shopId, ids),
  sync: (data, opts) => enqueueSync(data, opts),
  bulkFinished: async (bulkId, status) => {
    await redis().publish(bulkChannel(bulkId), status);
  },
};

export type DispatchResult = { duplicate: boolean; shopKnown: boolean; actions: WebhookAction[] };

/** Chèn receipt; trùng webhookId (Shopify retry / gửi lặp) → bỏ qua. */
async function firstDelivery(db: Db, w: VerifiedWebhook): Promise<boolean> {
  try {
    await db.webhookReceipt.create({
      data: { webhookId: w.webhookId, topic: w.topic, shopDomain: w.shop },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

export async function dispatchWebhook(
  w: VerifiedWebhook,
  deps: { db: Db; sink?: WebhookSink },
  actions: WebhookAction[] = w.kind === "event"
    ? eventActions(w.payload)
    : webhookActions(w.topic, w.payload),
): Promise<DispatchResult> {
  const sink = deps.sink ?? defaultSink;
  if (!(await firstDelivery(deps.db, w))) return { duplicate: true, shopKnown: true, actions: [] };
  const shop = await deps.db.shop.findUnique({ where: { domain: w.shop }, select: { id: true } });

  for (const a of actions) {
    switch (a.kind) {
      case "redact":
        // shop/redact đến 48h sau khi gỡ: xoá theo domain kể cả khi đã xoá Shop.
        await sink.sync({ type: "redact", shopDomain: w.shop }, { jobId: `redact-${w.shop}` });
        continue;
      case "log":
        console.info(`[compliance] ${w.topic} for ${w.shop} (no customer data stored)`);
        continue;
      case "bulk-finished":
        await sink.bulkFinished(a.bulkId, a.status);
        continue;
    }
    if (!shop) continue;
    switch (a.kind) {
      case "incremental":
        await sink.incremental(shop.id, a.productIds);
        break;
      case "delete":
        await sink.sync({ type: "delete", shopId: shop.id, productIds: a.productIds });
        break;
      case "collection":
        await sink.sync({
          type: "collection",
          shopId: shop.id,
          collectionId: a.collectionId,
          deleted: a.deleted,
        });
        break;
      case "inventory":
        await sink.sync({
          type: "inventory",
          shopId: shop.id,
          inventoryItemIds: a.inventoryItemIds,
        });
        break;
      case "shop-refresh":
        await sink.sync(
          { type: "shop-refresh", shopId: shop.id, what: a.what },
          { jobId: `refresh-${shop.id}-${a.what.join("-")}-${Math.floor(Date.now() / 10_000)}` },
        );
        break;
      case "uninstall":
        // Mục 5.4: xoá session ngay, dừng job, giữ index 48 giờ (job uninstall lo phần còn lại).
        await deps.db.session.deleteMany({ where: { shop: w.shop } });
        await deps.db.shop.update({ where: { id: shop.id }, data: { uninstalledAt: new Date() } });
        await sink.sync(
          { type: "uninstall", shopId: shop.id },
          { jobId: `uninstall-${shop.id}-${Date.now()}` },
        );
        break;
    }
  }
  return { duplicate: false, shopKnown: Boolean(shop), actions };
}

/** Dùng trong route: `export const action = ({ request }) => handleWebhookRequest(request)`. */
export async function handleWebhookRequest(
  request: Request,
  deps: { db?: Db; sink?: WebhookSink; secret?: string } = {},
): Promise<Response> {
  const secret = deps.secret ?? env().SHOPIFY_API_SECRET;
  const w = await readVerifiedWebhook(request, secret); // 401/400/405 → Response ném ra
  const db = deps.db ?? (await import("../../db.server")).default;
  await dispatchWebhook(w, { db, sink: deps.sink });
  return new Response(null, { status: 200 });
}
