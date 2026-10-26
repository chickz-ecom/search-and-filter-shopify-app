import type { Prisma } from "@prisma/client";
import type { GraphqlExecutor } from "../shopify/graphql";
import { fetchShopInfo } from "./install.server";
import type { Db, MarketInfo } from "./shop.server";

// Đồng bộ Shop.markets (task 1.14): currency + có giá cố định hay không, qua webhook markets/* và mỗi đêm
// (không có webhook cho catalog/price list → lượt đêm bắt thay đổi giá cố định).
// Query dựa trên docs/shopify-api/admin/markets.graphql (validate 2026-10); Market.priceList đã deprecated → catalogs.

export const MARKETS_QUERY = `query Markets($cursor: String) {
  markets(first: 50, after: $cursor) {
    nodes {
      handle
      type
      status
      currencySettings { baseCurrency { currencyCode } localCurrencies }
      conditions {
        regionsCondition {
          regions(first: 250) {
            nodes { ... on MarketRegionCountry { code currency { currencyCode } } }
          }
        }
      }
      catalogs(first: 5) {
        nodes {
          status
          priceList { currency fixedPricesCount parent { adjustment { type value } } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type MarketNode = {
  handle: string;
  type: string;
  status: string;
  currencySettings: {
    baseCurrency: { currencyCode: string } | null;
    localCurrencies: boolean;
  } | null;
  conditions: {
    regionsCondition: {
      regions: { nodes: ({ code?: string; currency?: { currencyCode: string } } | null)[] };
    } | null;
  } | null;
  catalogs: {
    nodes: {
      status: string;
      priceList: {
        currency: string;
        fixedPricesCount: number;
        parent: { adjustment: { type: string; value: number } | null } | null;
      } | null;
    }[];
  };
};

export type MarketDetail = MarketInfo & { adjustmentPct?: number; localCurrencies: boolean };

/** Chỉ market REGION đang ACTIVE ảnh hưởng giá storefront theo country. */
export function parseMarkets(nodes: MarketNode[], shopCurrency: string): MarketDetail[] {
  return nodes
    .filter((m) => m.status === "ACTIVE" && m.type === "REGION")
    .map((m) => {
      const countries = (m.conditions?.regionsCondition?.regions.nodes ?? [])
        .map((r) => r?.code)
        .filter((c): c is string => Boolean(c));
      const catalogs = m.catalogs.nodes.filter((c) => c.status === "ACTIVE" && c.priceList);
      const fixed = catalogs.some((c) => (c.priceList?.fixedPricesCount ?? 0) > 0);
      const adj = catalogs.find((c) => c.priceList?.parent?.adjustment)?.priceList?.parent
        ?.adjustment;
      const currency =
        catalogs.find((c) => c.priceList?.currency)?.priceList?.currency ??
        m.currencySettings?.baseCurrency?.currencyCode ??
        shopCurrency;
      return {
        handle: m.handle,
        countries,
        currency,
        hasFixedPrices: fixed,
        localCurrencies: Boolean(m.currencySettings?.localCurrencies),
        // VERIFY: giá trị enum PriceListAdjustmentType (PERCENTAGE_DECREASE / PERCENTAGE_INCREASE).
        ...(adj
          ? { adjustmentPct: adj.type === "PERCENTAGE_DECREASE" ? -adj.value : adj.value }
          : {}),
      };
    })
    .sort((a, b) => a.handle.localeCompare(b.handle));
}

export async function fetchMarkets(
  ex: GraphqlExecutor,
  shopCurrency: string,
): Promise<MarketDetail[]> {
  const nodes: MarketNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    type R = {
      markets: {
        nodes: MarketNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    const d: R = await ex.query<R>(MARKETS_QUERY, { cursor }, { estimatedCost: 900 });
    nodes.push(...d.markets.nodes);
    if (!d.markets.pageInfo.hasNextPage) break;
    cursor = d.markets.pageInfo.endCursor;
  }
  return parseMarkets(nodes, shopCurrency);
}

export type ShopRefreshResult = {
  marketsChanged: boolean;
  fixedPriceCountriesChanged: boolean;
  localesChanged: boolean;
  currencyChanged: boolean;
  /** Cần full sync: đổi currency gốc (giá index theo currency gốc), thêm locale, hoặc giá cố định đổi khi bật phương án B. */
  needsFullSync: boolean;
};

/** So sánh ổn định: jsonb của Postgres sắp lại thứ tự key nên không so JSON.stringify trực tiếp được. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

const fixedCountries = (ms: MarketInfo[]) =>
  ms
    .filter((m) => m.hasFixedPrices)
    .flatMap((m) => m.countries)
    .sort()
    .join(",");

export async function refreshShop(
  shopId: string,
  what: ("markets" | "locales" | "shop")[],
  deps: { db: Db; ex: GraphqlExecutor },
): Promise<ShopRefreshResult> {
  const shop = await deps.db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const data: Prisma.ShopUpdateInput = {};
  const result: ShopRefreshResult = {
    marketsChanged: false,
    fixedPriceCountriesChanged: false,
    localesChanged: false,
    currencyChanged: false,
    needsFullSync: false,
  };
  if (what.includes("locales") || what.includes("shop")) {
    const info = await fetchShopInfo(deps.ex);
    if (info.currency !== shop.currency) {
      data.currency = info.currency;
      result.currencyChanged = true;
    }
    const sameLocales =
      [...info.locales].sort().join(",") === [...shop.locales].sort().join(",") &&
      info.primaryLocale === shop.primaryLocale;
    if (!sameLocales) {
      data.locales = info.locales;
      data.primaryLocale = info.primaryLocale;
      result.localesChanged = true;
    }
  }
  if (what.includes("markets")) {
    const prev = (Array.isArray(shop.markets) ? shop.markets : []) as unknown as MarketInfo[];
    const next = await fetchMarkets(deps.ex, (data.currency as string) ?? shop.currency);
    if (canonical(prev) !== canonical(next)) {
      data.markets = next as unknown as Prisma.InputJsonValue;
      result.marketsChanged = true;
      result.fixedPriceCountriesChanged = fixedCountries(prev) !== fixedCountries(next);
    }
  }
  const features = (shop.features ?? {}) as { fixedMarketPrices?: boolean };
  result.needsFullSync =
    result.currencyChanged ||
    result.localesChanged ||
    (result.fixedPriceCountriesChanged && Boolean(features.fixedMarketPrices));
  if (Object.keys(data).length) await deps.db.shop.update({ where: { id: shopId }, data });
  return result;
}
