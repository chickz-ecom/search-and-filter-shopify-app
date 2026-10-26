import type { Pricer } from "./pricing";
import type { SearchAppContext } from "./types";
export declare const PRICES_QUERY = "query ProductPrices($ids:[ID!]!,$country:CountryCode,$language:LanguageCode)@inContext(country:$country,language:$language){nodes(ids:$ids){...on Product{id availableForSale priceRange{minVariantPrice{amount currencyCode}maxVariantPrice{amount currencyCode}}compareAtPriceRange{maxVariantPrice{amount currencyCode}}}}}";
/** "pt-BR" → "PT_BR" (enum LanguageCode). */
export declare const languageCode: (l: string) => string;
export declare function median(xs: number[]): number;
export type PricerDeps = {
    fetch?: typeof fetch;
    timeoutMs?: number;
    onError?: (e: unknown) => void;
    storage?: Pick<Storage, "getItem" | "setItem"> | null;
};
export declare function createPricer(ctx: SearchAppContext, deps?: PricerDeps): Pricer;
