import type { Redis } from "ioredis";
import { rkey } from "../redis.server";
import type { GraphqlExecutor } from "../shopify/graphql";
import {
  fetchProductMetafieldDefinitions,
  type MetafieldDefinition,
} from "../sync/metafields.server";

// Danh sách metafield definitions cho trang Search/Sorting/Filters (cache 10 phút để trang tải nhanh — Web Vitals).
export async function cachedMetafieldDefinitions(
  ex: GraphqlExecutor,
  shopId: string,
  redis?: Redis,
): Promise<MetafieldDefinition[]> {
  const key = rkey("mfdefs", shopId);
  const hit = await redis?.get(key).catch(() => null);
  if (hit) return JSON.parse(hit) as MetafieldDefinition[];
  const defs = await fetchProductMetafieldDefinitions(ex).catch(() => [] as MetafieldDefinition[]);
  await redis?.set(key, JSON.stringify(defs), "EX", 600).catch(() => undefined);
  return defs;
}
