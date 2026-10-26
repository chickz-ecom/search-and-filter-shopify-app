import { env } from "../env.server";
import type { SearchEngine } from "../search/engine";
import { parseTypesenseNodes, TypesenseEngine } from "../search/typesense-engine";
import type { ShopSearchContext } from "./context.server";

// Engine cho đường đọc (search-api, app proxy): scoped key theo shop (chỉ đọc collection của shop đó);
// shop chưa có key → key search-only chung (dev: admin key, có cảnh báo).
let shared: SearchEngine | undefined;
const perKey = new Map<string, SearchEngine>();

function node() {
  const e = env();
  return {
    host: e.TYPESENSE_HOST,
    port: e.TYPESENSE_PORT,
    protocol: e.TYPESENSE_PROTOCOL,
    nodes: e.TYPESENSE_NODES ? parseTypesenseNodes(e.TYPESENSE_NODES) : undefined,
  } as const;
}

export function sharedSearchEngine(): SearchEngine {
  if (!shared) {
    const e = env();
    if (!e.TYPESENSE_SEARCH_ONLY_KEY && e.NODE_ENV === "production") {
      console.warn("[search] TYPESENSE_SEARCH_ONLY_KEY not set — falling back to the admin key");
    }
    shared = new TypesenseEngine({
      ...node(),
      apiKey: e.TYPESENSE_SEARCH_ONLY_KEY || e.TYPESENSE_API_KEY,
      connectionTimeoutSeconds: 2,
    });
  }
  return shared;
}

export function engineForShop(ctx: ShopSearchContext): SearchEngine {
  const key = ctx.shop.searchKeyScoped;
  if (!key) return sharedSearchEngine();
  let eng = perKey.get(key);
  if (!eng) {
    eng = new TypesenseEngine({ ...node(), apiKey: key, connectionTimeoutSeconds: 2 });
    perKey.set(key, eng);
  }
  return eng;
}
