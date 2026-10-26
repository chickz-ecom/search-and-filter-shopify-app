import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { headlessAllowed, planById, plans } from "../billing/plans";
import { afterConfigSaved } from "../search-service/purge.server";
import { shopFeatures, type Db } from "../shop/shop.server";
import { zodErrors, type FieldErrors } from "./search-settings.server";

// Trang Developers (task 3.8): public key, endpoint, snippet, link docs, bật/tắt headless (+ origin được phép).

export type DevelopersInfo = {
  shopDomain: string;
  publicKey: string;
  endpoint: string;
  docsUrl: string;
  headless: {
    entitled: boolean;
    minPlan: string;
    enabled: boolean;
    origins: string[];
  };
};

type ShopRow = { id: string; domain: string; publicKey: string; plan: string; features: unknown };

export function developersInfo(shop: ShopRow, endpoint: string, docsUrl: string): DevelopersInfo {
  const f = shopFeatures(shop as Parameters<typeof shopFeatures>[0]);
  return {
    shopDomain: shop.domain,
    publicKey: shop.publicKey,
    endpoint: endpoint.replace(/\/$/, ""),
    docsUrl,
    headless: {
      entitled: headlessAllowed(shop.plan, f),
      minPlan: plans().find((p) => p.visible && p.headless)?.name ?? planById("pro").name,
      enabled: Boolean(f.headlessEnabled),
      origins: f.headlessOrigins ?? [],
    },
  };
}

const origin = z
  .string()
  .trim()
  .transform((s) => s.toLowerCase().replace(/\/$/, ""))
  .refine((s) => {
    try {
      const u = new URL(s);
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      return (u.protocol === "https:" || (local && u.protocol === "http:")) && u.origin === s;
    } catch {
      return false;
    }
  }, "Use an origin like https://www.example.com (no path)");

export const DevelopersInput = z.object({
  headlessEnabled: z.boolean(),
  headlessOrigins: z.array(origin).max(20, "Add up to 20 origins"),
});

export async function saveDevelopers(
  db: Db,
  shop: ShopRow,
  input: unknown,
  deps: { purge?: typeof afterConfigSaved } = {},
): Promise<{ ok: true } | { ok: false; errors: FieldErrors }> {
  const r = DevelopersInput.safeParse(input);
  if (!r.success) return { ok: false, errors: zodErrors(r.error.issues) };
  const current = shopFeatures(shop as Parameters<typeof shopFeatures>[0]);
  if (r.data.headlessEnabled && !headlessAllowed(shop.plan, current))
    return {
      ok: false,
      errors: {
        headlessEnabled: `Headless access needs the ${planById("pro").name} plan or higher`,
      },
    };
  const features = {
    ...current,
    headlessEnabled: r.data.headlessEnabled,
    headlessOrigins: [...new Set(r.data.headlessOrigins)],
  };
  await db.shop.update({
    where: { id: shop.id },
    data: { features: features as Prisma.InputJsonValue },
  });
  await (deps.purge ?? afterConfigSaved)(db, shop);
  return { ok: true };
}
