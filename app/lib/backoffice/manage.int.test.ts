import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { entitlements, planById } from "../billing/plans";
import { ensureShop } from "../shop/shop.server";
import { createAgent } from "./auth.server";
import {
  deletePlan,
  getDashboard,
  listShops,
  saveOverrides,
  savePlan,
  setBlocked,
} from "./manage.server";

const up = await postgresUp();

describe.skipIf(!up)("back-office management (8.3)", () => {
  const tag = Date.now().toString(36);
  const planId = `bo-${tag}`;
  const domain = `bo-${tag}.myshopify.com`;
  const actor = { id: "", email: `ops-${tag}@example.com` };
  let shopId = "";

  beforeAll(async () => {
    const { agent } = await createAgent(testDb(), {
      email: actor.email,
      name: "Ops",
      password: "a-long-password-1",
      role: "Support",
    });
    actor.id = agent.id;
    const { shop } = await ensureShop(testDb(), domain);
    shopId = shop.id;
    await testDb().shop.update({
      where: { id: shopId },
      data: { productCount: 500, features: { headlessEnabled: true } },
    });
  });
  afterAll(async () => {
    await testDb().auditLog.deleteMany({ where: { targetId: { in: [planId, shopId] } } });
    await testDb().planConfig.deleteMany({ where: { id: planId } });
    await testDb().shop.deleteMany({ where: { domain } });
    await testDb().agent.deleteMany({ where: { email: actor.email } });
  });

  const plan = {
    id: planId,
    name: "Back-office test",
    priceUsd: "29",
    maxProducts: "2000",
    rpm: "5000",
    semantic: true,
    headless: false,
    visible: false,
    position: "50",
  };

  it("creates and updates plans, refreshes the registry, validates and audits", async () => {
    expect(await savePlan(testDb(), actor, plan, "create")).toEqual({ ok: true, id: planId });
    expect(planById(planId)).toMatchObject({
      name: "Back-office test",
      priceUsd: 29,
      semantic: true,
    });
    expect(await savePlan(testDb(), actor, plan, "create")).toMatchObject({
      ok: false,
      errors: { id: expect.any(String) },
    });
    expect(await savePlan(testDb(), actor, { ...plan, id: "Bad Handle!" }, "create")).toMatchObject(
      { ok: false },
    );
    await savePlan(testDb(), actor, { ...plan, rpm: "7000" }, "update");
    expect(planById(planId).rpm).toBe(7000);
    const log = await testDb().auditLog.findFirst({
      where: { targetId: planId, action: "plan.update" },
    });
    expect(log?.details).toEqual({ rpm: [5000, 7000] });
    expect(await deletePlan(testDb(), actor, "free")).toMatchObject({ ok: false });
  });

  it("comps a plan with an expiry and overrides limits without touching other shop flags", async () => {
    const r = await saveOverrides(testDb(), actor, shopId, {
      compPlan: planId,
      compUntil: "2099-12-31",
      maxProducts: "",
      rpm: "1234",
      semantic: false,
      headless: true,
    });
    expect(r).toEqual({ ok: true });
    const shop = await testDb().shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop.features).toMatchObject({
      headlessEnabled: true,
      compPlan: planId,
      rpm: 1234,
      headless: true,
    });
    expect(entitlements(shop)).toMatchObject({
      planId,
      comped: true,
      maxProducts: 2000,
      rpm: 1234,
      semantic: true,
      headless: true,
    });
    expect(
      await saveOverrides(testDb(), actor, shopId, {
        compPlan: "nope",
        semantic: false,
        headless: false,
      }),
    ).toMatchObject({ ok: false });
    // Shop đang dùng gói tặng → gói đang trả vẫn là free; xoá gói tặng chỉ bị chặn khi có shop TRẢ cho gói đó.
    expect(
      (await listShops(testDb(), { q: domain, filter: "comped" })).shops.map((s) => s.domain),
    ).toEqual([domain]);
  });

  it("blocks and lists by status; the dashboard counts shops, MRR and over-limit catalogs", async () => {
    await setBlocked(testDb(), actor, shopId, true, "Chargeback");
    expect((await listShops(testDb(), { q: domain, filter: "blocked" })).total).toBe(1);
    await setBlocked(testDb(), actor, shopId, false, "");
    expect((await listShops(testDb(), { q: domain, filter: "blocked" })).total).toBe(0);
    // Gỡ gói tặng → quay về free (99 sản phẩm) → shop 500 sản phẩm vượt giới hạn.
    await saveOverrides(testDb(), actor, shopId, { semantic: false, headless: false });
    expect((await listShops(testDb(), { q: domain, filter: "over" })).shops[0]).toMatchObject({
      domain,
      over: true,
    });
    const d = await getDashboard(testDb());
    expect(d.activeShops).toBeGreaterThan(0);
    expect(d.overLimit.some((o) => o.domain === domain)).toBe(true);
    const actions = await testDb().auditLog.findMany({
      where: { targetId: shopId },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "shop.overrides",
      "shop.block",
      "shop.unblock",
      "shop.overrides",
    ]);
  });
});
