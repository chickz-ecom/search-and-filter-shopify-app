import type { Prisma } from "@prisma/client";
import { AppearanceSchema, normalizeTokens, type AppearanceConfig } from "../config/appearance";
import { afterConfigSaved } from "../search-service/purge.server";
import type { Db } from "../shop/shop.server";
import { zodErrors, type FieldErrors } from "./search-settings.server";

// Appearance (task 3.6, mục 9: POST /app/appearance).
export async function loadAppearance(db: Db, shopId: string): Promise<AppearanceConfig> {
  const row = await db.appearance.findUnique({ where: { shopId } });
  return {
    tokens: normalizeTokens(row?.tokens),
    texts: (row?.texts ?? {}) as AppearanceConfig["texts"],
    templates: (row?.templates ?? {}) as AppearanceConfig["templates"],
  };
}

export async function saveAppearance(
  db: Db,
  shop: { id: string; domain: string },
  input: unknown,
  deps: { purge?: typeof afterConfigSaved } = {},
): Promise<{ ok: true } | { ok: false; errors: FieldErrors }> {
  const r = AppearanceSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: zodErrors(r.error.issues) };
  // Bỏ text rỗng (dùng mặc định) và template rỗng.
  const texts = Object.fromEntries(
    Object.entries(r.data.texts).map(([l, m]) => [
      l,
      Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim())),
    ]),
  );
  const templates = Object.fromEntries(
    Object.entries(r.data.templates).filter(([, v]) => v?.trim()),
  );
  const data = {
    tokens: r.data.tokens as unknown as Prisma.InputJsonValue,
    texts: texts as Prisma.InputJsonValue,
    templates: templates as Prisma.InputJsonValue,
  };
  await db.appearance.upsert({
    where: { shopId: shop.id },
    update: data,
    create: { shopId: shop.id, ...data },
  });
  await (deps.purge ?? afterConfigSaved)(db, shop);
  return { ok: true };
}
