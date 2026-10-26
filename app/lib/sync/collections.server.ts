import type { SearchEngine } from "../search/engine";
import { contentAlias } from "../search/names";
import { quote } from "../search/query/filters";
import type { ContentDoc } from "../search/product-doc";
import type { GraphqlExecutor } from "../shopify/graphql";
import { writeTargets, type IncrementalDeps } from "./incremental.server";
import { gidToId } from "./mapper";
import { COLLECTION_PRODUCTS_ORDERED_QUERY, COST } from "./queries";

// Thay đổi collection (task 1.8, D8): thành viên + thứ tự thủ công (pos_{id}).
// Nguồn: Events collection.products / collection.sortOrder, webhook collections/*.
// Lưu ý: smart collection đổi thành viên do tag/thuộc tính đổi cũng bắn products/update → incremental lấy lại
// product.collections, nên thành viên vẫn đúng kể cả khi Events không bắn cho smart collection (CHƯA XN).

export type CollectionChange = {
  collectionId: string;
  deleted?: boolean;
  added?: string[];
  removed?: string[];
  sortOrder?: string | null;
};

type Ordered = {
  handle: string;
  title: string;
  sortOrder: string;
  updatedAt: string;
  productIds: string[];
};

export async function fetchCollectionOrdered(
  ex: GraphqlExecutor,
  collectionId: string,
  maxPages = 400,
): Promise<Ordered | null> {
  let cursor: string | null = null;
  const ids: string[] = [];
  let meta: Omit<Ordered, "productIds"> | null = null;
  for (let page = 0; page < maxPages; page++) {
    type R = {
      collection: {
        handle: string;
        title: string;
        sortOrder: string;
        updatedAt: string;
        products: {
          nodes: { id: string }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    };
    const d: R = await ex.query<R>(
      COLLECTION_PRODUCTS_ORDERED_QUERY,
      { id: `gid://shopify/Collection/${collectionId}`, cursor },
      { estimatedCost: COST.delta },
    );
    if (!d.collection) return null;
    meta ??= {
      handle: d.collection.handle,
      title: d.collection.title,
      sortOrder: d.collection.sortOrder,
      updatedAt: d.collection.updatedAt,
    };
    ids.push(...d.collection.products.nodes.map((n) => gidToId(n.id)));
    if (!d.collection.products.pageInfo.hasNextPage) break;
    cursor = d.collection.products.pageInfo.endCursor;
  }
  return meta ? { ...meta, productIds: ids } : null;
}

type MembershipDoc = {
  id: string;
  collections: string[];
  collection_handles: string[];
  collection_titles: string[];
};

async function docsWith(
  engine: SearchEngine,
  target: string,
  filterBy: string,
): Promise<MembershipDoc[]> {
  const out: MembershipDoc[] = [];
  for await (const d of engine.exportDocuments<MembershipDoc>(
    target,
    ["id", "collections", "collection_handles", "collection_titles"],
    filterBy,
  )) {
    out.push(d);
  }
  return out;
}

function without(doc: MembershipDoc, collectionId: string) {
  const keep = doc.collections
    .map((c, i) => [c, i] as const)
    .filter(([c]) => c !== collectionId)
    .map(([, i]) => i);
  return {
    id: doc.id,
    collections: keep.map((i) => doc.collections[i]),
    collection_handles: keep.map((i) => doc.collection_handles[i] ?? ""),
    collection_titles: keep.map((i) => doc.collection_titles[i] ?? ""),
    [`pos_${collectionId}`]: null,
  };
}

function withMember(
  doc: MembershipDoc,
  c: { id: string; handle: string; title: string },
  pos: number | null,
) {
  const idx = doc.collections.indexOf(c.id);
  const collections = [...doc.collections];
  const handles = [...doc.collection_handles];
  const titles = [...doc.collection_titles];
  if (idx < 0) {
    collections.push(c.id);
    handles.push(c.handle);
    titles.push(c.title);
  } else {
    handles[idx] = c.handle;
    titles[idx] = c.title;
  }
  return {
    id: doc.id,
    collections,
    collection_handles: handles,
    collection_titles: titles,
    [`pos_${c.id}`]: pos,
  };
}

export type CollectionSyncResult = {
  mode: "deleted" | "full" | "delta";
  members: number;
  removed: number;
  updated: number;
};

export async function syncCollection(
  shopId: string,
  change: CollectionChange,
  deps: IncrementalDeps,
): Promise<CollectionSyncResult> {
  const targets = await writeTargets(shopId, deps);
  const cid = change.collectionId;

  if (change.deleted) {
    let removed = 0;
    for (const t of targets) {
      const docs = await docsWith(deps.engine, t, `collections:=${quote(cid)}`);
      await deps.engine.updateDocuments(
        t,
        docs.map((d) => without(d, cid)),
      );
      removed = Math.max(removed, docs.length);
    }
    await deps.engine.deleteDocuments(contentAlias(shopId), [`collection-${cid}`]).catch(() => 0);
    return { mode: "deleted", members: 0, removed, updated: 0 };
  }

  const ordered = await fetchCollectionOrdered(deps.ex, cid);
  if (!ordered) return syncCollection(shopId, { collectionId: cid, deleted: true }, deps);
  const manual = ordered.sortOrder === "MANUAL";
  const shop = await deps.db.shop.findUnique({ where: { id: shopId }, select: { features: true } });
  const posCap = (shop?.features as { posCap?: number | null } | null)?.posCap ?? undefined;
  const info = { id: cid, handle: ordered.handle, title: ordered.title };
  const position = new Map(ordered.productIds.map((id, i) => [id, i + 1]));

  // Cập nhật index nội dung (tiêu đề, handle, sortOrder cho sort mặc định của trang collection).
  const content: ContentDoc & { sort_order: string } = {
    id: `collection-${cid}`,
    type: "collection",
    title: ordered.title,
    handle: ordered.handle,
    url: `/collections/${ordered.handle}`,
    body_text: "",
    products_count: ordered.productIds.length,
    updated_at: Math.floor(Date.parse(ordered.updatedAt) / 1000) || 0,
    sort_order: ordered.sortOrder,
  };
  await deps.engine
    .importDocuments(contentAlias(shopId), [content], "upsert")
    .catch(() => undefined);

  let updated = 0;
  let removed = 0;
  for (const t of targets) {
    const current = await docsWith(deps.engine, t, `collections:=${quote(cid)}`);
    const currentIds = new Set(current.map((d) => d.id));
    const leaving = current.filter((d) => !position.has(d.id));
    // Thành viên mới: lấy mảng collections hiện có của chúng để thêm vào.
    const joining = ordered.productIds.filter((id) => !currentIds.has(id));
    const joiningDocs: MembershipDoc[] = [];
    for (let i = 0; i < joining.length; i += 200) {
      const part = joining.slice(i, i + 200);
      joiningDocs.push(...(await docsWith(deps.engine, t, `id:[${part.map(quote).join(",")}]`)));
    }
    const staying = current.filter((d) => position.has(d.id));
    const updates = [
      ...leaving.map((d) => without(d, cid)),
      ...[...staying, ...joiningDocs].map((d) =>
        withMember(
          d,
          info,
          manual && (!posCap || position.get(d.id)! <= posCap) ? position.get(d.id)! : null,
        ),
      ),
    ];
    const r = await deps.engine.updateDocuments(t, updates);
    updated = Math.max(updated, r.success - leaving.length);
    removed = Math.max(removed, leaving.length);
  }
  return {
    mode: change.added || change.removed ? "delta" : "full",
    members: ordered.productIds.length,
    removed,
    updated,
  };
}
