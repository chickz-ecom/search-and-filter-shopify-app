import { z } from "zod";
import { Prisma } from "@prisma/client";
import { entitlements, planById, plans, type PlanOverrides } from "../billing/plans";
import { refreshPlans } from "../billing/plans-registry.server";
import { enqueueSync } from "../queue/queue.server";
import { purgeShopConfig } from "../search-service/context.server";
import type { Db } from "../shop/shop.server";
import { audit, diff } from "./audit.server";

// Back-office (8.3): logic Plans, Shops, Dashboard. Mọi thay đổi ghi audit log; đổi gói → làm mới registry ngay.

type Actor = { id: string; email: string };
const DAY = 24 * 3600_000;

// ---------- Plans ----------

export const PlanInput = z.object({
  id: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,39}$/,
      "Use 2–40 lowercase letters, digits or hyphens, matching the plan handle in the Partner Dashboard",
    ),
  name: z.string().trim().min(1, "Enter a name").max(60),
  priceUsd: z.coerce.number().min(0, "Price can't be negative").max(100_000),
  maxProducts: z.coerce.number().int().min(1, "At least 1 product").max(10_000_000),
  rpm: z.coerce.number().int().min(10, "At least 10 requests per minute").max(1_000_000),
  semantic: z.boolean(),
  headless: z.boolean(),
  visible: z.boolean(),
  position: z.coerce.number().int().min(0).max(1000),
});
export type PlanInput = z.infer<typeof PlanInput>;

export async function listPlansWithUsage(db: Db) {
  await refreshPlans(db, { force: true });
  const counts = await db.shop.groupBy({
    by: ["plan"],
    where: { uninstalledAt: null },
    _count: { _all: true },
  });
  const byPlan = new Map(counts.map((c) => [c.plan, c._count._all]));
  return plans().map((p) => ({ ...p, shops: byPlan.get(p.id) ?? 0 }));
}

export async function savePlan(
  db: Db,
  actor: Actor,
  raw: unknown,
  mode: "create" | "update",
): Promise<{ ok: true; id: string } | { ok: false; errors: Record<string, string> }> {
  const parsed = PlanInput.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
    };
  const p = parsed.data;
  const before = await db.planConfig.findUnique({ where: { id: p.id } });
  if (mode === "create" && before)
    return { ok: false, errors: { id: "A plan with this handle already exists" } };
  if (mode === "update" && !before) return { ok: false, errors: { id: "Plan not found" } };
  await db.planConfig.upsert({ where: { id: p.id }, update: p, create: p });
  await audit(
    db,
    actor,
    mode === "create" ? "plan.create" : "plan.update",
    { type: "plan", id: p.id },
    before
      ? diff(
          Object.fromEntries(
            Object.keys(p).map((k) => [
              k,
              k === "priceUsd" ? Number(before.priceUsd) : before[k as keyof typeof before],
            ]),
          ),
          p,
        )
      : p,
  );
  await refreshPlans(db, { force: true });
  return { ok: true, id: p.id };
}

export async function deletePlan(
  db: Db,
  actor: Actor,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (id === "free")
    return {
      ok: false,
      error: "The free plan is the fallback for every shop and can't be deleted.",
    };
  const using = await db.shop.count({ where: { plan: id, uninstalledAt: null } });
  if (using) return { ok: false, error: `${using} shops are on this plan. Hide it instead.` };
  await db.planConfig.delete({ where: { id } });
  await audit(db, actor, "plan.delete", { type: "plan", id });
  await refreshPlans(db, { force: true });
  return { ok: true };
}

// ---------- Shops ----------

export type ShopFilter = "all" | "active" | "uninstalled" | "blocked" | "comped" | "error" | "over";
export const SHOP_PAGE = 25;

export async function listShops(
  db: Db,
  opts: { q?: string; plan?: string; filter?: ShopFilter; page?: number },
  now = new Date(),
) {
  const where: Prisma.ShopWhereInput = {
    ...(opts.q ? { domain: { contains: opts.q.trim().toLowerCase() } } : {}),
    ...(opts.plan ? { plan: opts.plan } : {}),
    ...(opts.filter === "uninstalled" ? { uninstalledAt: { not: null } } : {}),
    ...(opts.filter && !["all", "uninstalled"].includes(opts.filter)
      ? { uninstalledAt: null }
      : {}),
    ...(opts.filter === "error" ? { syncState: "ERROR" } : {}),
    ...(opts.filter === "blocked" ? { features: { path: ["blocked"], equals: true } } : {}),
    ...(opts.filter === "comped" ? { features: { path: ["compPlan"], not: Prisma.AnyNull } } : {}),
  };
  const rows = await db.shop.findMany({
    where,
    orderBy: { installedAt: "desc" },
    select: {
      id: true,
      domain: true,
      plan: true,
      features: true,
      productCount: true,
      installedAt: true,
      uninstalledAt: true,
      syncState: true,
    },
  });
  // "Vượt giới hạn" cần quyền lợi hiệu lực → lọc trong bộ nhớ (số shop của một app vừa phải).
  const shaped = rows
    .map((s) => {
      const e = entitlements(s, now);
      return {
        ...s,
        effectivePlan: e.planId,
        comped: e.comped,
        blocked: e.blocked,
        over: s.productCount > e.maxProducts,
      };
    })
    .filter((s) => opts.filter !== "over" || s.over);
  const pages = Math.max(1, Math.ceil(shaped.length / SHOP_PAGE));
  const page = Math.min(pages, Math.max(1, opts.page ?? 1));
  return {
    total: shaped.length,
    page,
    pages,
    shops: shaped.slice((page - 1) * SHOP_PAGE, page * SHOP_PAGE),
  };
}

export async function shopDetail(db: Db, id: string, now = new Date()) {
  const shop = await db.shop.findUnique({ where: { id } });
  if (!shop) return null;
  const since = new Date(now.getTime() - 30 * DAY);
  const [jobs, searches, history] = await Promise.all([
    db.syncJob.findMany({ where: { shopId: id }, orderBy: { startedAt: "desc" }, take: 8 }),
    db.analyticsDaily.aggregate({
      where: { shopId: id, date: { gte: since }, query: { not: "" } },
      _sum: { searches: true },
    }),
    db.auditLog.findMany({
      where: { targetType: "shop", targetId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  return {
    shop,
    overrides: (shop.features ?? {}) as PlanOverrides,
    entitlements: entitlements(shop, now),
    paidPlan: planById(shop.plan),
    jobs,
    searches30: Number(searches._sum.searches ?? 0),
    history,
  };
}

export const OverridesInput = z.object({
  compPlan: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || undefined),
  compUntil: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Use a date like 2026-12-31"),
  maxProducts: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(10_000_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  rpm: z
    .union([z.literal(""), z.coerce.number().int().min(10).max(1_000_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  semantic: z.boolean(),
  headless: z.boolean(),
});

const OVERRIDE_KEYS = [
  "compPlan",
  "compUntil",
  "maxProducts",
  "rpm",
  "semantic",
  "headless",
] as const;

/** Gói tặng, giới hạn và tính năng ghi đè — giữ nguyên các cờ khác trong features (headlessEnabled, …). */
export async function saveOverrides(
  db: Db,
  actor: Actor,
  shopId: string,
  raw: unknown,
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const parsed = OverridesInput.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
    };
  const o = parsed.data;
  if (o.compPlan && !plans().some((p) => p.id === o.compPlan))
    return { ok: false, errors: { compPlan: "Unknown plan" } };
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const features = { ...((shop.features ?? {}) as Record<string, unknown>) };
  const before = Object.fromEntries(OVERRIDE_KEYS.map((k) => [k, features[k]]));
  for (const k of OVERRIDE_KEYS) delete features[k];
  if (o.compPlan) {
    features.compPlan = o.compPlan;
    if (o.compUntil)
      features.compUntil = new Date(`${o.compUntil.slice(0, 10)}T23:59:59Z`).toISOString();
  }
  if (o.maxProducts !== undefined) features.maxProducts = o.maxProducts;
  if (o.rpm !== undefined) features.rpm = o.rpm;
  if (o.semantic) features.semantic = true;
  if (o.headless) features.headless = true;
  const after = Object.fromEntries(OVERRIDE_KEYS.map((k) => [k, features[k]]));
  await db.shop.update({
    where: { id: shopId },
    data: { features: features as Prisma.InputJsonValue },
  });
  await audit(db, actor, "shop.overrides", { type: "shop", id: shopId }, diff(before, after));
  await purgeShopConfig(shop.domain).catch(() => undefined);
  return { ok: true };
}

export async function setBlocked(
  db: Db,
  actor: Actor,
  shopId: string,
  blocked: boolean,
  reason: string,
) {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const features = { ...((shop.features ?? {}) as Record<string, unknown>) };
  if (blocked) {
    features.blocked = true;
    features.blockedReason = reason.trim().slice(0, 500);
  } else {
    delete features.blocked;
    delete features.blockedReason;
  }
  await db.shop.update({
    where: { id: shopId },
    data: { features: features as Prisma.InputJsonValue },
  });
  await audit(
    db,
    actor,
    blocked ? "shop.block" : "shop.unblock",
    { type: "shop", id: shopId },
    blocked ? { reason } : {},
  );
  await purgeShopConfig(shop.domain).catch(() => undefined);
}

export async function saveNotes(db: Db, actor: Actor, shopId: string, notes: string) {
  const text = notes.trim().slice(0, 5000) || null;
  await db.shop.update({ where: { id: shopId }, data: { adminNotes: text } });
  await audit(db, actor, "shop.notes", { type: "shop", id: shopId });
}

export async function queueShopSync(
  db: Db,
  actor: Actor,
  shopId: string,
  type: "full" | "reindex",
) {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  if (shop.uninstalledAt) return { ok: false, error: "The app is uninstalled from this shop." };
  if (shop.syncState === "RUNNING" || shop.syncState === "QUEUED")
    return { ok: false, error: "A sync is already running." };
  await db.shop.update({ where: { id: shopId }, data: { syncState: "QUEUED" } });
  await enqueueSync(
    { type, shopId, reason: "backoffice" },
    { jobId: `${type}-${shopId}-${Date.now()}` },
  );
  await audit(db, actor, `shop.${type === "full" ? "sync" : "reindex"}`, {
    type: "shop",
    id: shopId,
  });
  return { ok: true };
}

// ---------- Dashboard ----------

export async function getDashboard(db: Db, now = new Date()) {
  await refreshPlans(db);
  const since = new Date(now.getTime() - 30 * DAY);
  const [active, installs, uninstalls, searches] = await Promise.all([
    db.shop.findMany({
      where: { uninstalledAt: null },
      select: {
        id: true,
        domain: true,
        plan: true,
        features: true,
        productCount: true,
        syncState: true,
      },
    }),
    db.shop.count({ where: { installedAt: { gte: since } } }),
    db.shop.count({ where: { uninstalledAt: { gte: since } } }),
    db.analyticsDaily.aggregate({
      where: { date: { gte: since }, query: { not: "" } },
      _sum: { searches: true },
    }),
  ]);
  const byPlan = new Map<string, { shops: number; mrr: number }>();
  let mrr = 0;
  let comped = 0;
  const over: { id: string; domain: string; products: number; limit: number }[] = [];
  for (const s of active) {
    const paid = planById(s.plan);
    const e = entitlements(s, now);
    const row = byPlan.get(paid.id) ?? { shops: 0, mrr: 0 };
    row.shops += 1;
    row.mrr += paid.priceUsd;
    byPlan.set(paid.id, row);
    mrr += paid.priceUsd;
    if (e.comped) comped += 1;
    if (s.productCount > e.maxProducts)
      over.push({ id: s.id, domain: s.domain, products: s.productCount, limit: e.maxProducts });
  }
  return {
    activeShops: active.length,
    installs30: installs,
    uninstalls30: uninstalls,
    mrr: Math.round(mrr * 100) / 100,
    comped,
    searches30: Number(searches._sum.searches ?? 0),
    plans: plans().map((p) => ({
      id: p.id,
      name: p.name,
      ...(byPlan.get(p.id) ?? { shops: 0, mrr: 0 }),
    })),
    syncErrors: active
      .filter((s) => s.syncState === "ERROR")
      .slice(0, 10)
      .map((s) => ({ id: s.id, domain: s.domain })),
    overLimit: over.sort((a, b) => b.products - b.limit - (a.products - a.limit)).slice(0, 10),
  };
}
