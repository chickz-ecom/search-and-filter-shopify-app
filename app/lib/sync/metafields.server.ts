import type { GraphqlExecutor } from "../shopify/graphql";
import type { MetafieldSpec } from "../search/index-schema";
import { METAFIELD_DEFINITIONS_QUERY, type MetafieldRef } from "./queries";

type DefPage = {
  metafieldDefinitions: {
    nodes: { namespace: string; key: string; name: string; type: { name: string } }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export type MetafieldDefinition = { namespace: string; key: string; name: string; type: string };

export async function fetchProductMetafieldDefinitions(
  ex: GraphqlExecutor,
): Promise<MetafieldDefinition[]> {
  const out: MetafieldDefinition[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const d: DefPage = await ex.query<DefPage>(
      METAFIELD_DEFINITIONS_QUERY,
      { cursor },
      { estimatedCost: 260 },
    );
    out.push(
      ...d.metafieldDefinitions.nodes.map((n) => ({
        namespace: n.namespace,
        key: n.key,
        name: n.name,
        type: n.type.name,
      })),
    );
    if (!d.metafieldDefinitions.pageInfo.hasNextPage) break;
    cursor = d.metafieldDefinitions.pageInfo.endCursor;
  }
  return out;
}

/** Gắn type cho metafield cần index; thiếu definition → coi là chuỗi. */
export function resolveMetafieldSpecs(
  refs: MetafieldRef[],
  defs: MetafieldDefinition[],
): MetafieldSpec[] {
  const byKey = new Map(defs.map((d) => [`${d.namespace}.${d.key}`, d.type]));
  return refs.map((r) => ({
    ...r,
    type: byKey.get(`${r.namespace}.${r.key}`) ?? "single_line_text_field",
  }));
}
