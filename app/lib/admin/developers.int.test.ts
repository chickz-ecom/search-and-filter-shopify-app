import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { ensureShop } from "../shop/shop.server";
import { developersInfo, saveDevelopers } from "./developers.server";

const up = await postgresUp();

describe.skipIf(!up)("Developers backend (3.8)", () => {
  const domain = `dev-${Date.now()}.myshopify.com`;
  const purge = vi.fn(async () => undefined);
  const shop = async () => await testDb().shop.findUniqueOrThrow({ where: { domain } });

  beforeAll(() => ensureShop(testDb(), domain));
  afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

  it("exposes key and endpoint; headless is off and not in the free plan", async () => {
    const info = developersInfo(await shop(), "https://api.example/", "");
    expect(info.publicKey).toMatch(/^pk_/);
    expect(info.endpoint).toBe("https://api.example");
    expect(info.headless).toEqual({ entitled: false, minPlan: "Pro", enabled: false, origins: [] });
    expect(
      await saveDevelopers(
        testDb(),
        await shop(),
        { headlessEnabled: true, headlessOrigins: [] },
        { purge },
      ),
    ).toEqual({
      ok: false,
      errors: { headlessEnabled: "Headless access needs the Pro plan or higher" },
    });
  });

  it("on Pro: enables headless, normalizes origins and keeps other feature flags", async () => {
    await testDb().shop.update({
      where: { domain },
      data: { plan: "pro", features: { fixedMarketPrices: true } },
    });
    const bad = await saveDevelopers(
      testDb(),
      await shop(),
      { headlessEnabled: true, headlessOrigins: ["https://ok.example/path"] },
      { purge },
    );
    expect(bad.ok).toBe(false);
    expect(
      await saveDevelopers(
        testDb(),
        await shop(),
        {
          headlessEnabled: true,
          headlessOrigins: ["https://App.Example/", "https://app.example", "http://localhost:3000"],
        },
        { purge },
      ),
    ).toEqual({ ok: true });
    const s = await shop();
    expect(s.features).toEqual({
      fixedMarketPrices: true,
      headlessEnabled: true,
      headlessOrigins: ["https://app.example", "http://localhost:3000"],
    });
    expect(developersInfo(s, "https://api.example", "").headless.enabled).toBe(true);
    expect(purge).toHaveBeenCalled();
  });
});
