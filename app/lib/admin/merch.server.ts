import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { MerchActionsSchema, MerchConditionSchema } from "../merch/engine-sync.server";
import { queryKey } from "../search/query/text-query";
import { afterConfigSaved } from "../search-service/purge.server";
import type { Db } from "../shop/shop.server";
import { zodErrors, type FieldErrors } from "./search-settings.server";

// Merchandising (task 3.5, mục 9: POST /app/merchandising/*): CRUD + đẩy sang engine + purge sau mỗi thay đổi.

export const MERCH_TYPES = ["synonyms", "redirects", "stopwords", "rules"] as const;
export type MerchType = (typeof MERCH_TYPES)[number];

const term = z.string().trim().min(1).max(100);

export const SynonymInput = z
  .object({
    type: z.enum(["multi", "one_way"]),
    root: z.string().trim().max(100).optional(),
    terms: z.array(term).min(1).max(20),
    locale: z.string().max(10).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.type === "one_way" && !s.root?.trim())
      ctx.addIssue({ code: "custom", path: ["root"], message: "Enter the search term" });
    if (s.type === "multi" && s.terms.length < 2)
      ctx.addIssue({ code: "custom", path: ["terms"], message: "Add at least two words" });
  });

export const RedirectInput = (shopDomain: string, storefrontDomains: string[]) =>
  z.object({
    query: z.string().trim().min(1).max(200),
    url: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((u) => {
        // Chống open redirect / XSS (security check 6.3): "\" bị trình duyệt hiểu như "/" ("/\evil.com" = "//evil.com"),
        // ký tự điều khiển cắt URL, và "javascript://shop/%0a…" có hostname là shop → phải ép http(s).
        // eslint-disable-next-line no-control-regex -- cố ý: loại ký tự điều khiển khỏi URL (security 6.3)
        if (/[\\\u0000-\u001f]/.test(u)) return false;
        if (u.startsWith("/")) return !u.startsWith("//");
        try {
          const url = new URL(u);
          return (
            (url.protocol === "https:" || url.protocol === "http:") &&
            [shopDomain, ...storefrontDomains].includes(url.hostname)
          );
        } catch {
          return false;
        }
      }, "Use a path on your store, like /collections/sale"),
  });

export const StopWordInput = z.object({
  word: z.string().trim().min(1).max(50),
  locale: z.string().trim().min(2).max(10).default("en"),
});

export const RuleInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean().default(true),
    condition: MerchConditionSchema,
    actions: MerchActionsSchema,
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  })
  .superRefine((r, ctx) => {
    if (!r.actions.pin.length && !r.actions.hide.length && !r.actions.boost.length) {
      ctx.addIssue({ code: "custom", path: ["actions"], message: "Add at least one action" });
    }
    if (r.startsAt && r.endsAt && Date.parse(r.endsAt) <= Date.parse(r.startsAt)) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
    }
  });

export type MerchLists = {
  synonyms: {
    id: string;
    type: string;
    root: string | null;
    terms: string[];
    locale: string | null;
  }[];
  redirects: { id: string; query: string; url: string }[];
  stopwords: { id: string; word: string; locale: string }[];
  rules: {
    id: string;
    name: string;
    enabled: boolean;
    condition: unknown;
    actions: unknown;
    startsAt: string | null;
    endsAt: string | null;
  }[];
};

export async function listMerch(db: Db, shopId: string): Promise<MerchLists> {
  const [synonyms, redirects, stopwords, rules] = await Promise.all([
    db.synonym.findMany({ where: { shopId }, orderBy: { createdAt: "desc" } }),
    db.redirect.findMany({ where: { shopId }, orderBy: { createdAt: "desc" } }),
    db.stopWord.findMany({ where: { shopId }, orderBy: { word: "asc" } }),
    db.merchRule.findMany({ where: { shopId }, orderBy: { updatedAt: "desc" } }),
  ]);
  return {
    synonyms: synonyms.map((s) => ({
      id: s.id,
      type: s.type,
      root: s.root,
      terms: s.terms,
      locale: s.locale,
    })),
    redirects: redirects.map((r) => ({ id: r.id, query: r.query, url: r.url })),
    stopwords: stopwords.map((w) => ({ id: w.id, word: w.word, locale: w.locale })),
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      condition: r.condition,
      actions: r.actions,
      startsAt: r.startsAt?.toISOString() ?? null,
      endsAt: r.endsAt?.toISOString() ?? null,
    })),
  };
}

export type MerchMutation =
  | { op: "upsert"; type: MerchType; id?: string; data: unknown }
  | { op: "delete"; type: MerchType; id: string };
export type MerchResult = { ok: true } | { ok: false; errors: FieldErrors };

type ShopRef = { id: string; domain: string; storefrontDomains?: string[] };

export async function mutateMerch(
  db: Db,
  shop: ShopRef,
  m: MerchMutation,
  deps: { purge?: typeof afterConfigSaved } = {},
): Promise<MerchResult> {
  const shopId = shop.id;
  const own = { shopId };
  if (m.op === "delete") {
    const where = { id: m.id, ...own };
    if (m.type === "synonyms") await db.synonym.deleteMany({ where });
    else if (m.type === "redirects") await db.redirect.deleteMany({ where });
    else if (m.type === "stopwords") await db.stopWord.deleteMany({ where });
    else await db.merchRule.deleteMany({ where });
  } else if (m.type === "synonyms") {
    const r = SynonymInput.safeParse(m.data);
    if (!r.success) return { ok: false, errors: zodErrors(r.error.issues) };
    const data = {
      type: r.data.type,
      root: r.data.type === "one_way" ? r.data.root!.trim() : null,
      terms: r.data.terms,
      locale: r.data.locale || null,
    };
    if (m.id) await db.synonym.updateMany({ where: { id: m.id, ...own }, data });
    else await db.synonym.create({ data: { ...data, shopId } });
  } else if (m.type === "redirects") {
    const r = RedirectInput(shop.domain, shop.storefrontDomains ?? []).safeParse(m.data);
    if (!r.success) return { ok: false, errors: zodErrors(r.error.issues) };
    const query = queryKey(r.data.query);
    const clash = await db.redirect.findUnique({ where: { shopId_query: { shopId, query } } });
    if (clash && clash.id !== m.id)
      return { ok: false, errors: { query: "A redirect for this search already exists" } };
    if (m.id)
      await db.redirect.updateMany({
        where: { id: m.id, ...own },
        data: { query, url: r.data.url },
      });
    else await db.redirect.create({ data: { shopId, query, url: r.data.url } });
  } else if (m.type === "stopwords") {
    const r = StopWordInput.safeParse(m.data);
    if (!r.success) return { ok: false, errors: zodErrors(r.error.issues) };
    const word = r.data.word.toLowerCase();
    await db.stopWord.upsert({
      where: { shopId_word_locale: { shopId, word, locale: r.data.locale } },
      update: {},
      create: { shopId, word, locale: r.data.locale },
    });
  } else {
    const r = RuleInput.safeParse(m.data);
    if (!r.success) return { ok: false, errors: zodErrors(r.error.issues) };
    const data = {
      name: r.data.name,
      enabled: r.data.enabled,
      condition: r.data.condition as Prisma.InputJsonValue,
      actions: r.data.actions as Prisma.InputJsonValue,
      startsAt: r.data.startsAt ? new Date(r.data.startsAt) : null,
      endsAt: r.data.endsAt ? new Date(r.data.endsAt) : null,
    };
    if (m.id) await db.merchRule.updateMany({ where: { id: m.id, ...own }, data });
    else await db.merchRule.create({ data: { ...data, shopId } });
  }
  await (deps.purge ?? afterConfigSaved)(db, shop, { merch: true });
  return { ok: true };
}
