import type { FakeCatalog } from "./fake-catalog";

/** JSONL cho bulk lồng (delta bulk) từ catalog: product, variant (__parentId), collection (__parentId). */
export function nestedJsonl(
  catalog: FakeCatalog,
  filter: (updatedAt: string) => boolean = () => true,
): string {
  const lines: string[] = [];
  for (const p of catalog.products.values()) {
    if (p.status !== "ACTIVE" || !p.onlineStoreUrl || !filter(p.updatedAt)) continue;
    lines.push(JSON.stringify(p));
    for (const v of catalog.variants.get(p.id) ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { product, ...rest } = v;
      lines.push(JSON.stringify({ ...rest, __parentId: p.id }));
    }
    for (const c of catalog.collections.values()) {
      if (c.products.includes(p.id)) {
        lines.push(
          JSON.stringify({
            id: `gid://shopify/Collection/${c.id}`,
            handle: c.handle,
            title: c.title,
            sortOrder: c.sortOrder,
            __parentId: p.id,
          }),
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}
