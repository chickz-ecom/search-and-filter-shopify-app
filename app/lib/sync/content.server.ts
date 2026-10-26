import type { SearchEngine } from "../search/engine";
import { contentAlias } from "../search/names";
import type { ContentDoc } from "../search/product-doc";
import { loadShopConfig, type Db } from "../shop/shop.server";
import { ShopifyGraphqlError, type GraphqlExecutor } from "../shopify/graphql";

// Trang + bài viết cho autocomplete/kết quả (mục 6.1; security check SCOPE_OVER_REQUEST — trước đây xin scope mà không
// index). Chỉ khi merchant bật kiểu tìm "pages"/"articles" VÀ đã cấp optional scope read_content +
// read_online_store_pages (validator 2026-10: docs/shopify-api/admin/online-store-content.graphql).

export const PAGES_QUERY = `query ContentPages($cursor: String) {
  pages(first: 250, after: $cursor) {
    nodes { id title handle body isPublished updatedAt }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const ARTICLES_QUERY = `query ContentArticles($cursor: String) {
  articles(first: 250, after: $cursor) {
    nodes { id title handle body isPublished updatedAt blog { handle } }
    pageInfo { hasNextPage endCursor }
  }
}`;
export { CONTENT_SCOPES } from "./content-scopes";

/** Giới hạn mỗi loại: autocomplete chỉ cần tiêu đề + đoạn đầu; shop có hàng chục nghìn bài viết không làm phình index. */
const MAX_PER_TYPE = 2_000;
const BODY_CHARS = 1_000;

type Node = {
  id: string;
  title: string;
  handle: string;
  body: string;
  isPublished: boolean;
  updatedAt: string;
  blog?: { handle: string };
};
type Page<K extends string> = Record<
  K,
  { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
>;

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const numericId = (gid: string) => gid.split("/").pop()!;

export function toContentDoc(n: Node, type: "page" | "article"): ContentDoc {
  return {
    id: `${type}-${numericId(n.id)}`,
    type,
    title: n.title,
    handle: n.handle,
    url: type === "page" ? `/pages/${n.handle}` : `/blogs/${n.blog?.handle ?? "news"}/${n.handle}`,
    body_text: stripHtml(n.body ?? "").slice(0, BODY_CHARS),
    updated_at: Math.floor(Date.parse(n.updatedAt) / 1000) || 0,
  };
}

async function fetchAll<K extends "pages" | "articles">(
  ex: GraphqlExecutor,
  query: string,
  key: K,
) {
  const out: Node[] = [];
  let cursor: string | null = null;
  do {
    const d: Page<K> = await ex.query<Page<K>>(query, { cursor });
    out.push(...d[key].nodes.filter((n) => n.isPublished));
    cursor = d[key].pageInfo.hasNextPage ? d[key].pageInfo.endCursor : null;
  } while (cursor && out.length < MAX_PER_TYPE);
  return out.slice(0, MAX_PER_TYPE);
}

const isAccessDenied = (e: unknown) =>
  e instanceof ShopifyGraphqlError &&
  /access denied|ACCESS_DENIED|not approved/i.test(`${e.message} ${JSON.stringify(e.errors)}`);

export type ContentRefreshResult = {
  pages: number;
  articles: number;
  skipped?: "disabled" | "scope" | "no-index";
};

/** Làm mới trang/bài viết trong index nội dung hiện tại (collection giữ nguyên). Idempotent. */
export async function refreshStoreContent(
  db: Db,
  engine: SearchEngine,
  ex: GraphqlExecutor,
  shopId: string,
): Promise<ContentRefreshResult> {
  const target = await engine.getAlias(contentAlias(shopId));
  if (!target) return { pages: 0, articles: 0, skipped: "no-index" };
  const types = (await loadShopConfig(db, shopId)).settings.searchTypes;
  const want = {
    page: types.pages.autocomplete || types.pages.results,
    article: types.articles.autocomplete || types.articles.results,
  };
  const docs: ContentDoc[] = [];
  let skipped: ContentRefreshResult["skipped"];
  try {
    if (want.page)
      docs.push(...(await fetchAll(ex, PAGES_QUERY, "pages")).map((n) => toContentDoc(n, "page")));
    if (want.article)
      docs.push(
        ...(await fetchAll(ex, ARTICLES_QUERY, "articles")).map((n) => toContentDoc(n, "article")),
      );
  } catch (e) {
    if (!isAccessDenied(e)) throw e;
    skipped = "scope"; // merchant chưa cấp optional scope → bỏ trang/bài viết, không làm hỏng sync
    docs.length = 0;
  }
  if (!want.page && !want.article) skipped = "disabled";
  if (docs.length) await engine.importDocuments(target, docs, "upsert");
  // Bỏ trang/bài viết đã xoá, ẩn hoặc loại đã tắt.
  const keep = new Set(docs.map((d) => d.id));
  const stale: string[] = [];
  for await (const d of engine.exportDocuments<{ id: string }>(
    target,
    ["id"],
    "type:[page,article]",
  ))
    if (!keep.has(d.id)) stale.push(d.id);
  if (stale.length) await engine.deleteDocuments(target, stale);
  return {
    pages: docs.filter((d) => d.type === "page").length,
    articles: docs.filter((d) => d.type === "article").length,
    ...(skipped ? { skipped } : {}),
  };
}
