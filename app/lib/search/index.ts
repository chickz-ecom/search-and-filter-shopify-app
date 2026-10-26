import { env } from "../env.server";
import type { SearchEngine } from "./engine";
import { parseTypesenseNodes, TypesenseEngine } from "./typesense-engine";

export * from "./engine";
export * from "./names";

let engine: SearchEngine | undefined;

export function getEngine(): SearchEngine {
  if (!engine) {
    const e = env();
    engine = new TypesenseEngine({
      host: e.TYPESENSE_HOST,
      port: e.TYPESENSE_PORT,
      protocol: e.TYPESENSE_PROTOCOL,
      apiKey: e.TYPESENSE_API_KEY,
      searchOnlyKey: e.TYPESENSE_SEARCH_ONLY_KEY,
      nodes: e.TYPESENSE_NODES ? parseTypesenseNodes(e.TYPESENSE_NODES) : undefined,
    });
  }
  return engine;
}

/** Cho test thay engine giả. */
export function setEngine(e: SearchEngine | undefined) {
  engine = e;
}
