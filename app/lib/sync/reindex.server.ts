import { Prisma } from "@prisma/client";
import type { Redis } from "ioredis";
import type { FieldDef, SearchEngine } from "../search/engine";
import { buildContentSchema, buildProductSchema, EMBEDDING_FIELD } from "../search/index-schema";
import {
  contentAlias,
  contentCollection,
  curationSetName,
  nextVersion,
  productAlias,
  productCollection,
  synonymSetName,
} from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { pushMerchToEngine } from "../merch/engine-sync.server";
import { loadShopConfig, shopFeatures, type Db } from "../shop/shop.server";
import { semanticAllowed } from "../billing/plans";
import { env } from "../env.server";
import { realClock, type Clock } from "../shopify/graphql";
import { countsAcceptable, fullSyncTargetKey } from "./full-sync.server";
import { importInBatches } from "./pipeline";
import { indexPercent, progressReporter } from "./progress";

// Reindex nội bộ (nút "Reindex" trang Sync): dựng lại index từ document ĐANG CÓ trong engine, không gọi Shopify.
// Dùng khi cần áp schema/cấu hình index hiện tại (synonym/curation set, AI search, ngôn ngữ) hoặc sửa index hỏng.
// Không lấy được sản phẩm/metafield mới — việc đó là của full sync ("Sync from Shopify").

export type ReindexDeps = {
  db: Db;
  engine: SearchEngine;
  redis?: Redis;
  clock?: Clock;
  embedModel?: string;
};

export type ReindexResult = {
  status: "SUCCEEDED" | "FAILED";
  collection: string | null;
  expected: number;
  imported: number;
  durationMs: number;
  error?: string;
};

export async function runReindex(
  shopId: string,
  deps: ReindexDeps,
  opts: { reason?: string } = {},
): Promise<ReindexResult> {
  const { db, engine } = deps;
  const clock = deps.clock ?? realClock;
  const t0 = clock.now();
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const job = await db.syncJob.create({
    data: {
      shopId,
      type: "REINDEX",
      status: "RUNNING",
      startedAt: new Date(t0),
      stats: { reason: opts.reason ?? "manual" },
    },
  });
  const progress = (data: Prisma.ShopUpdateInput) =>
    db.shop.update({ where: { id: shopId }, data }).catch(() => undefined);
  await progress({
    syncState: "RUNNING",
    indexedCount: 0,
    syncProgress: { phase: "prepare", percent: 0 },
  });
  // Reindex không tải từ Shopify: chuẩn bị → dựng index 5–95% → chuyển index.
  const report = progressReporter(
    (p) => progress({ syncProgress: p }),
    () => clock.now(),
  );

  let name: string | null = null;
  let created = false;
  let expected = 0;
  const finish = async (r: Omit<ReindexResult, "durationMs">): Promise<ReindexResult> => {
    const durationMs = clock.now() - t0;
    await deps.redis?.del(fullSyncTargetKey(shopId)).catch(() => undefined);
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: r.status,
        finishedAt: new Date(clock.now()),
        error: r.error ?? null,
        stats: { reason: opts.reason ?? "manual", ...r, durationMs } as Prisma.InputJsonValue,
      },
    });
    return { ...r, durationMs };
  };

  try {
    const alias = productAlias(shopId);
    const current = await engine.getAlias(alias);
    const info = current ? await engine.getCollection(current) : null;
    if (!current || !info) throw new Error("No index yet: run Sync from Shopify first");
    expected = info.numDocuments;
    const version = nextVersion(current);
    name = productCollection(shopId, version);

    const config = await loadShopConfig(db, shopId);
    await pushMerchToEngine(db, engine, shopId);
    const schema = buildProductSchema({
      name,
      metafields: [],
      locales: shop.locales.filter((l) => l !== shop.primaryLocale),
      synonymSets: [synonymSetName(shopId)],
      curationSets: [curationSetName(shopId)],
      semantic:
        config.settings.semanticSearch && semanticAllowed(shop.plan, shopFeatures(shop))
          ? { model: deps.embedModel ?? env().TYPESENSE_EMBED_MODEL }
          : undefined,
    });
    // Giữ field metafield của bản cũ (định nghĩa lấy từ engine, không cần hỏi Shopify).
    const have = new Set(schema.fields.map((f) => f.name));
    const metafieldFields: FieldDef[] = info.fields
      .filter((f) => f.name.startsWith("mf_") && !have.has(f.name))
      .map((f) => ({ name: f.name, type: f.type, optional: true, facet: f.facet, sort: f.sort }));
    const embedAt = schema.fields.findIndex((f) => f.name === EMBEDDING_FIELD);
    schema.fields.splice(embedAt < 0 ? schema.fields.length : embedAt, 0, ...metafieldFields);
    await engine.createCollection(schema);
    created = true;
    // Webhook trong lúc reindex ghi đôi vào bản mới (cùng cơ chế full sync).
    await deps.redis?.set(fullSyncTargetKey(shopId), name, "EX", 3600);

    let last = 0;
    report({ phase: "index", percent: 5 });
    const imported = await importInBatches(
      engine,
      name,
      engine.exportDocuments<ProductDoc>(current, [], undefined, [EMBEDDING_FIELD]),
      {
        onProgress: (n) => {
          report({ phase: "index", percent: indexPercent(n, expected, 5, 95) });
          if (clock.now() - last > 1000) {
            last = clock.now();
            void progress({ indexedCount: n });
          }
        },
      },
    );
    if (
      !countsAcceptable(expected, imported.imported) ||
      imported.failed > Math.max(5, expected * 0.001)
    ) {
      throw new Error(
        `Count check failed: expected ${expected}, imported ${imported.imported}, failed ${imported.failed}`,
      );
    }

    report({ phase: "finalize", percent: 97 });
    await copyContentIndex(shopId, version, engine);
    await engine.upsertAlias(alias, name);
    await engine.dropCollection(current);
    const indexed = (await engine.getCollection(name))?.numDocuments ?? imported.imported;
    await progress({
      syncState: "IDLE",
      syncProgress: Prisma.DbNull,
      indexVersion: version,
      indexedCount: indexed,
      // Bản export có thể cũ hơn thay đổi đến trong lúc copy → lùi watermark để lượt delta 5 phút lấy lại.
      lastSyncedUpdatedAt: minDate(shop.lastSyncedUpdatedAt, new Date(t0 - 2 * 60 * 1000)),
    });
    return finish({ status: "SUCCEEDED", collection: name, expected, imported: imported.imported });
  } catch (err) {
    if (created && name) await engine.dropCollection(name).catch(() => undefined);
    await progress({ syncState: "ERROR", syncProgress: Prisma.DbNull });
    return finish({
      status: "FAILED",
      collection: name,
      expected,
      imported: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Index c_{shopId} (collection/trang/bài viết) sang cùng version, swap alias. */
async function copyContentIndex(shopId: string, version: number, engine: SearchEngine) {
  const alias = contentAlias(shopId);
  const old = await engine.getAlias(alias);
  if (!old) return;
  const name = contentCollection(shopId, version);
  await engine.createCollection(buildContentSchema(name));
  const docs: { id: string }[] = [];
  for await (const d of engine.exportDocuments<{ id: string }>(old, [])) docs.push(d);
  if (docs.length) await engine.importDocuments(name, docs, "upsert");
  await engine.upsertAlias(alias, name);
  await engine.dropCollection(old);
}

function minDate(a: Date | null, b: Date): Date {
  return a && a < b ? a : b;
}
