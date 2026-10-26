import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { FilterItemsSchema, type FilterItem } from "../config/filters";
import { enqueueSync } from "../queue/queue.server";
import { afterConfigSaved } from "../search-service/purge.server";
import { loadShopConfig, requiredMetafields, type Db } from "../shop/shop.server";
import { zodErrors, type FieldErrors } from "./search-settings.server";

// Trang Filters (task 3.4, mục 9: POST /app/filters): cây filter mặc định, riêng trang search, ghi đè theo collection.

export const FiltersFormSchema = z.object({
  default: FilterItemsSchema,
  /** null = trang search dùng cây mặc định. */
  search: FilterItemsSchema.nullable(),
  collections: z.record(z.string().regex(/^\d+$/), FilterItemsSchema),
});
export type FiltersForm = z.infer<typeof FiltersFormSchema>;

export async function loadFiltersForm(db: Db, shopId: string): Promise<FiltersForm> {
  const c = await loadShopConfig(db, shopId);
  return {
    default: c.filters.default,
    search: c.filters.search ?? null,
    collections: c.filters.collections,
  };
}

const json = (items: FilterItem[]) =>
  items.map((it, i) => ({ ...it, position: i })) as unknown as Prisma.InputJsonValue;

export type FiltersSaveResult = { ok: true; reindex: boolean } | { ok: false; errors: FieldErrors };

export async function saveFilters(
  db: Db,
  shop: { id: string; domain: string; onboarding: unknown },
  input: unknown,
  deps: {
    enqueueFullSync?: (shopId: string) => Promise<void>;
    purge?: typeof afterConfigSaved;
  } = {},
): Promise<FiltersSaveResult> {
  const parsed = FiltersFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error.issues) };
  const f = parsed.data;
  const before = requiredMetafields(await loadShopConfig(db, shop.id))
    .map((m) => `${m.namespace}.${m.key}`)
    .sort()
    .join();
  await db.$transaction([
    db.filterSet.deleteMany({ where: { shopId: shop.id } }),
    db.filterSet.createMany({
      data: [
        { shopId: shop.id, scope: "DEFAULT" as const, collectionId: "", items: json(f.default) },
        ...(f.search
          ? [{ shopId: shop.id, scope: "SEARCH" as const, collectionId: "", items: json(f.search) }]
          : []),
        ...Object.entries(f.collections).map(([collectionId, items]) => ({
          shopId: shop.id,
          scope: "COLLECTION" as const,
          collectionId,
          items: json(items),
        })),
      ],
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
    filters: new Date().toISOString(),
  };
  await db.shop.update({
    where: { id: shop.id },
    data: { onboarding: onboarding as Prisma.InputJsonValue },
  });
  await (deps.purge ?? afterConfigSaved)(db, shop);
  return { ok: true, reindex };
}
