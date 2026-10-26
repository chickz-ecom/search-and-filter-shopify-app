import { afterAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { DEFAULT_TOKENS } from "../config/appearance";
import { ensureShop } from "../shop/shop.server";
import { loadAppearance, saveAppearance } from "./appearance.server";

const up = await postgresUp();

describe.skipIf(!up)("Appearance backend (3.6)", () => {
  const domain = `app-${Date.now()}.myshopify.com`;
  afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

  it("saves tokens/texts/templates, drops empty overrides, rejects unsafe templates", async () => {
    const { shop } = await ensureShop(testDb(), domain);
    const purge = vi.fn(async () => undefined);
    expect(await loadAppearance(testDb(), shop.id)).toEqual({
      tokens: DEFAULT_TOKENS,
      texts: {},
      templates: {},
    });
    const bad = await saveAppearance(
      testDb(),
      shop,
      { tokens: DEFAULT_TOKENS, texts: {}, templates: { "product-card": '<img onerror="x">' } },
      { purge },
    );
    expect(bad.ok).toBe(false);
    const ok = await saveAppearance(
      testDb(),
      shop,
      {
        tokens: { ...DEFAULT_TOKENS, accent: "#ff0000" },
        texts: { vi: { placeholder: "Tìm gì?", soldOut: " " } },
        templates: { "product-card": "<li>{{title}}</li>", empty: "" },
      },
      { purge },
    );
    expect(ok).toEqual({ ok: true });
    expect(await loadAppearance(testDb(), shop.id)).toEqual({
      tokens: { ...DEFAULT_TOKENS, accent: "#ff0000" },
      texts: { vi: { placeholder: "Tìm gì?" } },
      templates: { "product-card": "<li>{{title}}</li>" },
    });
    expect(purge).toHaveBeenCalledTimes(1);
  });
});
