import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { SortKeySchema, SortOptionSchema, TIE_BREAKS, type SortKey } from "../config/sort-options";
import { enqueueSync } from "../queue/queue.server";
import type { SearchEngine } from "../search/engine";
import { contentAlias, productAlias } from "../search/names";
import { afterConfigSaved } from "../search-service/purge.server";
import { loadShopConfig, requiredMetafields, type Db } from "../shop/shop.server";
import { zodErrors, type FieldErrors } from "./search-settings.server";

// Trang Sorting (task 3.3, mục 9: POST /app/sorting). Một lần lưu gồm: danh sách option (bật/tắt, nhãn theo locale,
// thứ tự), sort mặc định (search, collection), ghi đè theo collection, tie-break của relevance.

export const SortingFormSchema = z
  .object({
    options: z.array(SortOptionSchema).min(1).max(30),
    defaults: z.object({ search: SortKeySchema.optional(), collection: SortKeySchema.optional() }),
    overrides: z
      .array(z.object({ collectionId: z.string().regex(/^\d+$/), sortKey: SortKeySchema }))
      .max(500),
    tieBreak: z.enum(TIE_BREAKS),
  })
  .superRefine((f, ctx) => {
    const keys = new Set<string>();
    f.options.forEach((o, i) => {
      if (keys.has(o.key))
        ctx.addIssue({
          code: "custom",
          path: ["options", i, "key"],
          message: "Duplicate sort option",
        });
      keys.add(o.key);
      if (!Object.values(o.label).some((l) => l.trim()))
        ctx.addIssue({ code: "custom", path: ["options", i, "label"], message: "Add a label" });
    });
    if (!f.options.some((o) => o.enabled))
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Enable at least one sort option",
      });
    const enabled = new Set(f.options.filter((o) => o.enabled).map((o) => o.key));
    if (f.defaults.search && !enabled.has(f.defaults.search)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaults", "search"],
        message: "The default sort must be enabled",
      });
    }
    if (f.defaults.collection && !enabled.has(f.defaults.collection)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaults", "collection"],
        message: "The default sort must be enabled",
      });
    }
  });

export type SortingForm = z.infer<typeof SortingFormSchema>;

export async function loadSortingForm(db: Db, shopId: string): Promise<SortingForm> {
  const [config, settings, rows] = await Promise.all([
    loadShopConfig(db, shopId),
    db.searchSettings.findUnique({ where: { shopId }, select: { relevanceTieBreak: true } }),
    db.sortDefault.findMany({ where: { shopId, scope: "COLLECTION" } }),
  ]);
  return {
    options: config.sortOptions,
    defaults: {
      search: config.sortDefaults.search,
      collection: config.sortDefaults.collectionDefault,
    },
    overrides: rows.map((r) => ({ collectionId: r.collectionId, sortKey: r.sortKey as SortKey })),
    tieBreak: (settings?.relevanceTieBreak as SortingForm["tieBreak"]) ?? "best_selling",
  };
}

/** Option thiếu dữ liệu → disable kèm giải thích (mục 8: best-selling khi chưa có order). */
export async function sortDataAvailability(
  engine: SearchEngine,
  shopId: string,
): Promise<{ bestSelling: boolean }> {
  const r = await engine
    .search(productAlias(shopId), {
      q: "*",
      queryBy: ["title"],
      filterBy: "best_selling_rank:>0",
      perPage: 0,
    })
    .catch(() => null);
  return { bestSelling: (r?.found ?? 0) > 0 };
}

/** Tên collection cho ghi đè (index nội dung c_{shop}). */
export async function collectionTitles(
  engine: SearchEngine,
  shopId: string,
  ids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      const d = await engine
        .getDocument<{ title: string }>(contentAlias(shopId), `collection-${id}`)
        .catch(() => null);
      if (d) out[id] = d.title;
    }),
  );
  return out;
}

export type SortingSaveResult = { ok: true; reindex: boolean } | { ok: false; errors: FieldErrors };

export async function saveSorting(
  db: Db,
  shop: { id: string; domain: string; onboarding: unknown },
  input: unknown,
  deps: {
    enqueueFullSync?: (shopId: string) => Promise<void>;
    purge?: typeof afterConfigSaved;
  } = {},
): Promise<SortingSaveResult> {
  const parsed = SortingFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error.issues) };
  const f = parsed.data;
  const before = requiredMetafields(await loadShopConfig(db, shop.id))
    .map((m) => `${m.namespace}.${m.key}`)
    .sort()
    .join();
  await db.$transaction([
    db.sortOption.deleteMany({ where: { shopId: shop.id } }),
    db.sortOption.createMany({
      data: f.options.map((o, i) => ({
        shopId: shop.id,
        key: o.key,
        label: o.label,
        enabled: o.enabled,
        position: i,
      })),
    }),
    db.sortDefault.deleteMany({ where: { shopId: shop.id } }),
    db.sortDefault.createMany({
      data: [
        ...(f.defaults.search
          ? [
              {
                shopId: shop.id,
                scope: "SEARCH" as const,
                collectionId: "",
                sortKey: f.defaults.search,
              },
            ]
          : []),
        ...(f.defaults.collection
          ? [
              {
                shopId: shop.id,
                scope: "COLLECTION_DEFAULT" as const,
                collectionId: "",
                sortKey: f.defaults.collection,
              },
            ]
          : []),
        ...f.overrides.map((o) => ({
          shopId: shop.id,
          scope: "COLLECTION" as const,
          collectionId: o.collectionId,
          sortKey: o.sortKey,
        })),
      ],
    }),
    db.searchSettings.update({
      where: { shopId: shop.id },
      data: { relevanceTieBreak: f.tieBreak },
    }),
  ]);
  const after = requiredMetafields(await loadShopConfig(db, shop.id))
    .map((m) => `${m.namespace}.${m.key}`)
    .sort()
    .join();
  const reindex = before !== after;
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
    sorting: new Date().toISOString(),
  };
  await db.shop.update({
    where: { id: shop.id },
    data: { onboarding: onboarding as Prisma.InputJsonValue },
  });
  await (deps.purge ?? afterConfigSaved)(db, shop);
  return { ok: true, reindex };
}
