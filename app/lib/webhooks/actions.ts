// Map topic webhook → việc cần làm (thuần, test được). Webhook chỉ là tín hiệu "X đã đổi" (D7).

export type WebhookAction =
  | { kind: "incremental"; productIds: string[] }
  | { kind: "delete"; productIds: string[] }
  | {
      kind: "collection";
      collectionId: string;
      deleted?: boolean;
      added?: string[];
      removed?: string[];
      sortOrder?: string | null;
    }
  | { kind: "inventory"; inventoryItemIds: string[] }
  | { kind: "shop-refresh"; what: ("markets" | "locales" | "shop")[] }
  | { kind: "bulk-finished"; bulkId: string; status: string }
  | { kind: "uninstall" }
  | { kind: "redact" }
  | { kind: "log" };

const idOf = (v: unknown): string | null => {
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) return String(v);
  if (typeof v === "string") {
    const m = /\/(\d+)$/.exec(v);
    return m ? m[1] : null;
  }
  return null;
};

export function webhookActions(topic: string, payload: Record<string, unknown>): WebhookAction[] {
  const id = idOf(payload.id ?? payload.admin_graphql_api_id);
  switch (topic) {
    case "products/create":
    case "products/update":
      return id ? [{ kind: "incremental", productIds: [id] }] : [];
    case "products/delete":
      return id ? [{ kind: "delete", productIds: [id] }] : [];
    case "collections/create":
    case "collections/update":
      return id ? [{ kind: "collection", collectionId: id }] : [];
    case "collections/delete":
      return id ? [{ kind: "collection", collectionId: id, deleted: true }] : [];
    case "inventory_levels/update": {
      const item = idOf(payload.inventory_item_id);
      return item ? [{ kind: "inventory", inventoryItemIds: [item] }] : [];
    }
    case "inventory_items/update":
      return id ? [{ kind: "inventory", inventoryItemIds: [id] }] : [];
    case "markets/create":
    case "markets/update":
    case "markets/delete":
      return [{ kind: "shop-refresh", what: ["markets"] }];
    case "locales/create":
    case "locales/update":
      return [{ kind: "shop-refresh", what: ["locales"] }];
    case "shop/update":
      return [{ kind: "shop-refresh", what: ["shop"] }];
    case "bulk_operations/finish": {
      const bulkId =
        typeof payload.admin_graphql_api_id === "string" ? payload.admin_graphql_api_id : null;
      return bulkId
        ? [{ kind: "bulk-finished", bulkId, status: String(payload.status ?? "") }]
        : [];
    }
    case "app/uninstalled":
      return [{ kind: "uninstall" }];
    case "shop/redact":
      return [{ kind: "redact" }];
    case "customers/redact":
    case "customers/data_request":
      // App không lưu dữ liệu khách hàng (D13): chỉ ghi log và trả 200.
      return [{ kind: "log" }];
    default:
      return [];
  }
}

// Events API (D8). fields_changed: "collection[id: 'gid://shopify/Collection/1'].products[id: 'gid://shopify/Product/2']".
const PRODUCT_IN_PATH = /products\[id: '([^']+)'\]/;
const COLLECTION_IN_PATH = /collection\[id: '([^']+)'\]/;

type EventPayload = {
  topic?: string;
  action?: string;
  handle?: string;
  data?: { collection?: { id?: string; sortOrder?: string } | null } | null;
  fields_changed?: { added?: string[]; updated?: string[]; removed?: string[] };
  query_variables?: { collectionId?: string };
};

export function eventActions(payload: EventPayload): WebhookAction[] {
  if (payload.topic !== "Collection") return [];
  const fc = payload.fields_changed ?? {};
  const all = [...(fc.added ?? []), ...(fc.updated ?? []), ...(fc.removed ?? [])];
  const gid =
    payload.data?.collection?.id ??
    payload.query_variables?.collectionId ??
    all.map((p) => COLLECTION_IN_PATH.exec(p)?.[1]).find(Boolean);
  const collectionId = gid ? idOf(gid) : null;
  if (!collectionId) return [];
  if (payload.action === "delete") return [{ kind: "collection", collectionId, deleted: true }];
  const products = (list: string[] | undefined) =>
    (list ?? [])
      .map((p) => PRODUCT_IN_PATH.exec(p)?.[1])
      .map((g) => (g ? idOf(g) : null))
      .filter((x): x is string => Boolean(x));
  const added = products(fc.added);
  const removed = products(fc.removed);
  const sortChanged = all.some((p) => p.endsWith(".sortOrder"));
  return [
    {
      kind: "collection",
      collectionId,
      ...(added.length ? { added } : {}),
      ...(removed.length ? { removed } : {}),
      ...(sortChanged || payload.handle === "collection-sort-order"
        ? { sortOrder: payload.data?.collection?.sortOrder ?? null }
        : {}),
    },
  ];
}
