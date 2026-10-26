import { afterAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { FakeShopify, instantClock } from "../../../test/fakes/fake-shopify";
import { postgresUp } from "../../../test/services";
import { GraphqlExecutor } from "../shopify/graphql";
import { parseMarkets, refreshShop } from "./markets.server";
import { ensureShop } from "./shop.server";

const up = await postgresUp();

const market = (
  handle: string,
  countries: string[],
  currency: string,
  fixed = 0,
  extra: Record<string, unknown> = {},
) => ({
  handle,
  type: "REGION",
  status: "ACTIVE",
  currencySettings: { baseCurrency: { currencyCode: currency }, localCurrencies: true },
  conditions: {
    regionsCondition: {
      regions: { nodes: countries.map((code) => ({ code, currency: { currencyCode: currency } })) },
    },
  },
  catalogs: {
    nodes:
      fixed >= 0
        ? [
            {
              status: "ACTIVE",
              priceList: {
                currency,
                fixedPricesCount: fixed,
                parent: { adjustment: { type: "PERCENTAGE_INCREASE", value: 10 } },
              },
            },
          ]
        : [],
  },
  ...extra,
});

describe("markets (1.14)", () => {
  it("parses active region markets, currency, fixed prices and adjustment", () => {
    const parsed = parseMarkets(
      [
        market("us", ["US"], "USD", -1),
        market("eu", ["DE", "FR"], "EUR", 0),
        market("vn", ["VN"], "VND", 120),
        market("draft", ["JP"], "JPY", 0, { status: "DRAFT" }),
        market("b2b", [], "USD", 0, { type: "COMPANY_LOCATION" }),
      ] as never,
      "USD",
    );
    expect(parsed).toEqual([
      {
        handle: "eu",
        countries: ["DE", "FR"],
        currency: "EUR",
        hasFixedPrices: false,
        localCurrencies: true,
        adjustmentPct: 10,
      },
      {
        handle: "us",
        countries: ["US"],
        currency: "USD",
        hasFixedPrices: false,
        localCurrencies: true,
      },
      {
        handle: "vn",
        countries: ["VN"],
        currency: "VND",
        hasFixedPrices: true,
        localCurrencies: true,
        adjustmentPct: 10,
      },
    ]);
  });

  describe.skipIf(!up)("refreshShop", () => {
    const domain = `mkt-${Date.now()}.myshopify.com`;
    afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

    it("stores markets and flags a full sync only when it matters", async () => {
      const { shop } = await ensureShop(testDb(), domain, {
        currency: "USD",
        primaryLocale: "en",
        locales: ["en"],
      });
      const fake = new FakeShopify({});
      let markets = [market("eu", ["DE"], "EUR", 0)];
      fake.handlers.Markets = () => ({
        markets: { nodes: markets, pageInfo: { hasNextPage: false, endCursor: null } },
      });
      fake.handlers.ShopInfo = () => ({
        shop: { currencyCode: "USD", myshopifyDomain: domain },
        shopLocales: [{ locale: "en", primary: true, published: true }],
      });
      const deps = { db: testDb(), ex: new GraphqlExecutor(fake.transport, instantClock()) };

      const r1 = await refreshShop(shop.id, ["markets"], deps);
      expect(r1).toMatchObject({
        marketsChanged: true,
        fixedPriceCountriesChanged: false,
        needsFullSync: false,
      });
      expect((await testDb().shop.findUniqueOrThrow({ where: { id: shop.id } })).markets).toEqual([
        {
          handle: "eu",
          countries: ["DE"],
          currency: "EUR",
          hasFixedPrices: false,
          localCurrencies: true,
          adjustmentPct: 10,
        },
      ]);
      expect(await refreshShop(shop.id, ["markets"], deps)).toMatchObject({
        marketsChanged: false,
      });

      // Giá cố định xuất hiện: chỉ cần full sync khi bật phương án B (fixedMarketPrices).
      markets = [market("eu", ["DE"], "EUR", 0), market("vn", ["VN"], "VND", 5)];
      expect(await refreshShop(shop.id, ["markets"], deps)).toMatchObject({
        fixedPriceCountriesChanged: true,
        needsFullSync: false,
      });
      await testDb().shop.update({
        where: { id: shop.id },
        data: { features: { fixedMarketPrices: true } },
      });
      markets = [market("vn", ["VN"], "VND", 0)];
      expect(await refreshShop(shop.id, ["markets"], deps)).toMatchObject({
        fixedPriceCountriesChanged: true,
        needsFullSync: true,
      });

      // Thêm locale → cần full sync (bản dịch title_{l}).
      fake.handlers.ShopInfo = () => ({
        shop: { currencyCode: "USD", myshopifyDomain: domain },
        shopLocales: [
          { locale: "en", primary: true, published: true },
          { locale: "vi", primary: false, published: true },
        ],
      });
      expect(await refreshShop(shop.id, ["locales"], deps)).toMatchObject({
        localesChanged: true,
        needsFullSync: true,
      });
    });
  });
});
