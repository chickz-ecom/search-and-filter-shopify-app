import type { Prisma } from "@prisma/client";
import { SearchSettingsSchema, type SearchSettingsConfig } from "../config/search-settings";
import { enqueueSync } from "../queue/queue.server";
import { afterConfigSaved } from "../search-service/purge.server";
import { semanticAllowed } from "../billing/plans";
import {
  loadShopConfig,
  requiredMetafields,
  type Db,
  type ShopFeatures,
} from "../shop/shop.server";

// Lưu cấu hình Search (task 3.2, mục 9: POST /app/search intent save). Validate zod → lỗi inline theo path.
// Thêm/bớt trường metafield làm đổi tập field trong document → xếp full sync (mục 4.3). Trọng số/bật-tắt: không.

export type FieldErrors = Record<string, string>;

export function zodErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) out[i.path.map(String).join(".")] ??= i.message;
  return out;
}

export type SaveResult = { ok: true; reindex: boolean } | { ok: false; errors: FieldErrors };

export async function saveSearchSettings(
  db: Db,
  shop: { id: string; domain: string; onboarding: unknown; plan?: string; features?: unknown },
  input: unknown,
  deps: {
    enqueueFullSync?: (shopId: string) => Promise<void>;
    purge?: typeof afterConfigSaved;
  } = {},
): Promise<SaveResult> {
  const parsed = SearchSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error.issues) };
  const s: SearchSettingsConfig = parsed.data;
  const entitled = semanticAllowed(shop.plan, (shop.features ?? {}) as ShopFeatures);
  if (s.semanticSearch && !entitled)
    return { ok: false, errors: { semanticSearch: "AI search needs the Pro plan or higher" } };
  // Khoá schema: metafield có index + có field vector hay không (AI search) — đổi → full sync.
  const schemaKey = (c: Awaited<ReturnType<typeof loadShopConfig>>) =>
    [
      ...requiredMetafields(c)
        .map((m) => `${m.namespace}.${m.key}`)
        .sort(),
      c.settings.semanticSearch && entitled ? "embedding" : "",
    ].join(",");
  const before = schemaKey(await loadShopConfig(db, shop.id));
  await db.searchSettings.upsert({
    where: { shopId: shop.id },
    update: {
      fields: s.fields as unknown as Prisma.InputJsonValue,
      typoTolerance: s.typoTolerance,
      minWordLengthFor1Typo: s.minWordLengthFor1Typo,
      minWordLengthFor2Typo: s.minWordLengthFor2Typo,
      prioritizeExactMatch: s.prioritizeExactMatch,
      matchMode: s.matchMode,
      showOutOfStock: s.showOutOfStock,
      excludeTags: s.excludeTags,
      variantAsProduct: s.variantAsProduct,
      searchTypes: s.searchTypes as unknown as Prisma.InputJsonValue,
      relevanceTieBreak: s.relevanceTieBreak,
      semanticSearch: s.semanticSearch,
      semanticStrictness: s.semanticStrictness,
    },
    create: {
      shopId: shop.id,
      fields: s.fields as unknown as Prisma.InputJsonValue,
      searchTypes: s.searchTypes as unknown as Prisma.InputJsonValue,
      typoTolerance: s.typoTolerance,
      showOutOfStock: s.showOutOfStock,
      matchMode: s.matchMode,
      semanticSearch: s.semanticSearch,
      semanticStrictness: s.semanticStrictness,
    },
  });
  const reindex = before !== schemaKey(await loadShopConfig(db, shop.id));
  if (reindex) {
    await db.shop.update({ where: { id: shop.id }, data: { syncState: "QUEUED" } });
    await (
      deps.enqueueFullSync ??
      ((id) =>
        enqueueSync(
          { type: "full", shopId: id, reason: "schema-change" },
          { jobId: `full-${id}-${Date.now()}` },
        ))
    )(shop.id);
  }
  const onboarding = {
    ...((shop.onboarding as Record<string, string>) ?? {}),
    search: new Date().toISOString(),
  };
  await db.shop.update({
    where: { id: shop.id },
    data: { onboarding: onboarding as Prisma.InputJsonValue },
  });
  await (deps.purge ?? afterConfigSaved)(db, shop);
  return { ok: true, reindex };
}
