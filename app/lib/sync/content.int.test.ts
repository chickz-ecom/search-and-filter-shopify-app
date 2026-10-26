import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp, typesenseUp } from "../../../test/services";
import { buildContentSchema } from "../search/index-schema";
import { contentAlias, contentCollection } from "../search/names";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { ShopifyGraphqlError, type GraphqlExecutor } from "../shopify/graphql";
import { refreshStoreContent, stripHtml, toContentDoc } from "./content.server";

const up = (await postgresUp()) && (await typesenseUp());
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});
const node = (id: number, title: string, isPublished = true, blog?: string) => ({
  id: `gid://shopify/${blog ? "Article" : "Page"}/${id}`,
  title,
  handle: title.toLowerCase().replace(/\s+/g, "-"),
  body: `<p>${title} <b>details</b></p><script>alert(1)</script>`,
  isPublished,
  updatedAt: "2026-10-01T00:00:00Z",
  ...(blog ? { blog: { handle: blog } } : {}),
});
const fakeEx = (pages: unknown[], articles: unknown[], denied = false) =>
  ({
    query: async (q: string) => {
      if (denied)
        throw new ShopifyGraphqlError("Access denied for pages field.", [
          { message: "Access denied" },
        ]);
      return q.includes("pages(")
        ? { pages: { nodes: pages, pageInfo: { hasNextPage: false, endCursor: null } } }
        : { articles: { nodes: articles, pageInfo: { hasNextPage: false, endCursor: null } } };
    },
  }) as unknown as GraphqlExecutor;

describe("online store content (pages/articles) for search (6.3 scope fix)", () => {
  it("maps pages and articles to content docs with plain text", () => {
    expect(stripHtml("<p>Hi&nbsp;<b>there</b></p><style>x{}</style>")).toBe("Hi there");
    expect(toContentDoc(node(7, "Shipping info"), "page")).toMatchObject({
      id: "page-7",
      url: "/pages/shipping-info",
      body_text: "Shipping info details",
    });
    expect(toContentDoc(node(9, "Care guide", true, "news"), "article").url).toBe(
      "/blogs/news/care-guide",
    );
  });

  describe.skipIf(!up)("refreshStoreContent", () => {
    const domain = `cnt-${Date.now()}.myshopify.com`;
    let shopId: string;
    const name = () => contentCollection(shopId, 1);
    const setTypes = (pages: boolean, articles: boolean) =>
      testDb().searchSettings.update({
        where: { shopId },
        data: {
          searchTypes: {
            products: { autocomplete: true, results: true },
            collections: { autocomplete: true, results: false },
            pages: { autocomplete: pages, results: false },
            articles: { autocomplete: articles, results: false },
          },
        },
      });
    beforeAll(async () => {
      shopId = (await ensureShop(testDb(), domain)).shop.id;
      await engine.createCollection(buildContentSchema(name()));
      await engine.upsertAlias(contentAlias(shopId), name());
      await engine.importDocuments(name(), [
        {
          id: "collection-1",
          type: "collection",
          title: "Summer",
          handle: "summer",
          url: "/collections/summer",
          body_text: "",
          updated_at: 1,
        },
      ]);
    });
    afterAll(async () => {
      await engine.deleteAlias(contentAlias(shopId)).catch(() => undefined);
      await engine.dropCollection(name()).catch(() => undefined);
      await testDb().shop.deleteMany({ where: { domain } });
    });

    it("indexes published pages/articles when enabled, removes them when disabled, keeps collections", async () => {
      await setTypes(true, true);
      const ex = fakeEx(
        [node(1, "Shipping info"), node(2, "Draft page", false)],
        [node(3, "Care guide", true, "news")],
      );
      expect(await refreshStoreContent(testDb(), engine, ex, shopId)).toEqual({
        pages: 1,
        articles: 1,
      });
      const ids = async () => {
        const out: string[] = [];
        for await (const d of engine.exportDocuments<{ id: string }>(name(), ["id"]))
          out.push(d.id);
        return out.sort();
      };
      expect(await ids()).toEqual(["article-3", "collection-1", "page-1"]);
      await setTypes(true, false);
      expect(await refreshStoreContent(testDb(), engine, ex, shopId)).toEqual({
        pages: 1,
        articles: 0,
      });
      expect(await ids()).toEqual(["collection-1", "page-1"]);
    });

    it("skips cleanly when the optional scopes weren't granted", async () => {
      await setTypes(true, true);
      expect(await refreshStoreContent(testDb(), engine, fakeEx([], [], true), shopId)).toEqual({
        pages: 0,
        articles: 0,
        skipped: "scope",
      });
    });
  });
});
