import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { ensureShop } from "../shop/shop.server";
import { listMerch, mutateMerch } from "./merch.server";

const up = await postgresUp();

describe.skipIf(!up)("Merchandising backend (3.5)", () => {
  const domain = `mch-${Date.now()}.myshopify.com`;
  const other = `mch2-${Date.now()}.myshopify.com`;
  let shop: { id: string; domain: string; storefrontDomains: string[] };
  let otherShop: { id: string; domain: string };
  const purge = vi.fn(async () => undefined);

  beforeAll(async () => {
    const s = (await ensureShop(testDb(), domain, { domains: [domain, "shop.example"] })).shop;
    shop = { id: s.id, domain: s.domain, storefrontDomains: s.storefrontDomains };
    otherShop = (await ensureShop(testDb(), other)).shop;
  });
  afterAll(() => testDb().shop.deleteMany({ where: { domain: { in: [domain, other] } } }));

  it("creates, edits and deletes synonyms with validation", async () => {
    expect(
      await mutateMerch(
        testDb(),
        shop,
        { op: "upsert", type: "synonyms", data: { type: "multi", terms: ["tee"] } },
        { purge },
      ),
    ).toEqual({
      ok: false,
      errors: { terms: "Add at least two words" },
    });
    expect(
      await mutateMerch(
        testDb(),
        shop,
        { op: "upsert", type: "synonyms", data: { type: "one_way", terms: ["sneakers"] } },
        { purge },
      ),
    ).toEqual({
      ok: false,
      errors: { root: "Enter the search term" },
    });
    expect(
      await mutateMerch(
        testDb(),
        shop,
        { op: "upsert", type: "synonyms", data: { type: "multi", terms: ["tee", "t-shirt"] } },
        { purge },
      ),
    ).toEqual({ ok: true });
    const [s] = (await listMerch(testDb(), shop.id)).synonyms;
    await mutateMerch(
      testDb(),
      shop,
      {
        op: "upsert",
        type: "synonyms",
        id: s.id,
        data: { type: "one_way", root: "trainers", terms: ["sneakers"] },
      },
      { purge },
    );
    expect((await listMerch(testDb(), shop.id)).synonyms[0]).toMatchObject({
      type: "one_way",
      root: "trainers",
      terms: ["sneakers"],
    });
    // Không xoá được dữ liệu của shop khác (cách ly tenant).
    await mutateMerch(testDb(), otherShop, { op: "delete", type: "synonyms", id: s.id }, { purge });
    expect((await listMerch(testDb(), shop.id)).synonyms).toHaveLength(1);
    await mutateMerch(testDb(), shop, { op: "delete", type: "synonyms", id: s.id }, { purge });
    expect((await listMerch(testDb(), shop.id)).synonyms).toHaveLength(0);
    expect(purge).toHaveBeenCalledWith(testDb(), shop, { merch: true });
  });

  it("validates redirects: normalized query, unique, only store URLs", async () => {
    expect(
      await mutateMerch(
        testDb(),
        shop,
        { op: "upsert", type: "redirects", data: { query: " Shipping! ", url: "/pages/shipping" } },
        { purge },
      ),
    ).toEqual({ ok: true });
    expect((await listMerch(testDb(), shop.id)).redirects[0]).toMatchObject({
      query: "shipping",
      url: "/pages/shipping",
    });
    expect(
      await mutateMerch(
        testDb(),
        shop,
        { op: "upsert", type: "redirects", data: { query: "shipping", url: "/x" } },
        { purge },
      ),
    ).toEqual({
      ok: false,
      errors: { query: "A redirect for this search already exists" },
    });
    for (const url of [
      "/\\evil.example",
      "javascript://shop.example/%0aalert(1)",
      "/x\u0000y",
      "//evil.example",
    ]) {
      const r = await mutateMerch(
        testDb(),
        shop,
        { op: "upsert", type: "redirects", data: { query: `bad ${url}`, url } },
        { purge },
      );
      expect(r.ok, url).toBe(false);
    }
    const evil = await mutateMerch(
      testDb(),
      shop,
      { op: "upsert", type: "redirects", data: { query: "x", url: "https://evil.example/phish" } },
      { purge },
    );
    expect(evil.ok).toBe(false);
    expect(
      await mutateMerch(
        testDb(),
        shop,
        {
          op: "upsert",
          type: "redirects",
          data: { query: "faq", url: "https://shop.example/pages/faq" },
        },
        { purge },
      ),
    ).toEqual({ ok: true });
  });

  it("stop words are lowercased and unique; rules need an action and a valid schedule", async () => {
    await mutateMerch(
      testDb(),
      shop,
      { op: "upsert", type: "stopwords", data: { word: "The" } },
      { purge },
    );
    await mutateMerch(
      testDb(),
      shop,
      { op: "upsert", type: "stopwords", data: { word: "the" } },
      { purge },
    );
    expect((await listMerch(testDb(), shop.id)).stopwords.map((w) => w.word)).toEqual(["the"]);
    const bad = await mutateMerch(
      testDb(),
      shop,
      {
        op: "upsert",
        type: "rules",
        data: { name: "x", condition: { query: "red" }, actions: {} },
      },
      { purge },
    );
    expect(bad).toEqual({ ok: false, errors: { actions: "Add at least one action" } });
    const badDates = await mutateMerch(
      testDb(),
      shop,
      {
        op: "upsert",
        type: "rules",
        data: {
          name: "x",
          condition: { query: "red" },
          actions: { hide: ["1"] },
          startsAt: "2026-11-02T00:00:00Z",
          endsAt: "2026-11-01T00:00:00Z",
        },
      },
      { purge },
    );
    expect(badDates).toEqual({ ok: false, errors: { endsAt: "End must be after start" } });
    expect(
      await mutateMerch(
        testDb(),
        shop,
        {
          op: "upsert",
          type: "rules",
          data: {
            name: "Pin",
            condition: { query: "red", match: "contains" },
            actions: { pin: [{ productId: "5", position: 1 }] },
          },
        },
        { purge },
      ),
    ).toEqual({ ok: true });
    expect((await listMerch(testDb(), shop.id)).rules[0]).toMatchObject({
      name: "Pin",
      enabled: true,
    });
  });
});
