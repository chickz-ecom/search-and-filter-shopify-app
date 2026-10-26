import type { Pricer } from "./pricing";
import type { SearchAppContext } from "./types";

// Placeholder đến task 2.7b: cùng currency → không cần Storefront API.
export function createPricer(ctx: SearchAppContext): Pricer {
  return {
    needsLocalPrice: () => ctx.currency !== ctx.shopCurrency,
    localize: async () => ({ prices: new Map(), currency: ctx.currency, rate: 1, ok: false }),
    rate: () => 1,
  };
}
