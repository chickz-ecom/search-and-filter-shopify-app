import { afterAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { FakeShopify, instantClock } from "../../../test/fakes/fake-shopify";
import { postgresUp } from "../../../test/services";
import { GraphqlExecutor } from "../shopify/graphql";
import { onShopAuthenticated } from "./install.server";

const up = await postgresUp();

describe.skipIf(!up)("onShopAuthenticated", () => {
  const domain = `inst-${Date.now()}.myshopify.com`;
  const fake = new FakeShopify({});
  fake.handlers.ShopInfo = () => ({
    shop: { currencyCode: "EUR", myshopifyDomain: domain },
    shopLocales: [
      { locale: "de", primary: true, published: true },
      { locale: "en", primary: false, published: true },
      { locale: "fr", primary: false, published: false },
    ],
  });
  const ex = new GraphqlExecutor(fake.transport, instantClock());

  afterAll(async () => {
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("creates the shop with defaults and enqueues the first full sync once", async () => {
    const enqueueFullSync = vi.fn(async () => undefined);
    const r = await onShopAuthenticated(domain, { db: testDb(), ex, enqueueFullSync });
    expect(r).toMatchObject({ created: true, enqueued: true });
    expect(r.shop).toMatchObject({
      currency: "EUR",
      primaryLocale: "de",
      locales: ["de", "en"],
      syncState: "IDLE",
    });
    expect(r.shop.indexAlias).toBe(`p_${r.shop.id}`);
    expect(enqueueFullSync).toHaveBeenCalledWith(r.shop.id, "install");
    expect(await testDb().sortOption.count({ where: { shopId: r.shop.id } })).toBe(10);
    expect(await testDb().searchSettings.findUnique({ where: { shopId: r.shop.id } })).toBeTruthy();

    // Mở app lần nữa: đang QUEUED → không xếp thêm.
    const again = await onShopAuthenticated(domain, { db: testDb(), ex, enqueueFullSync });
    expect(again.enqueued).toBe(false);
    expect(enqueueFullSync).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues on reinstall", async () => {
    await testDb().shop.update({
      where: { domain },
      data: { uninstalledAt: new Date(), syncState: "IDLE", lastFullSyncAt: new Date() },
    });
    const enqueueFullSync = vi.fn(async () => undefined);
    const r = await onShopAuthenticated(domain, { db: testDb(), ex, enqueueFullSync });
    expect(r).toMatchObject({ reinstalled: true, enqueued: true });
    expect(r.shop.uninstalledAt).toBeNull();
    expect(enqueueFullSync).toHaveBeenCalledWith(r.shop.id, "reinstall");
  });
});
