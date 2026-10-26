import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp, typesenseUp } from "../../../test/services";
import { saveSearchSettings } from "../admin/search-settings.server";
import { defaultSearchSettings } from "../config/search-settings";
import { buildProductSchema } from "../search/index-schema";
import { productAlias, productCollection } from "../search/names";
import type { ProductDoc } from "../search/product-doc";
import { TypesenseEngine } from "../search/typesense-engine";
import { ensureShop } from "../shop/shop.server";
import { buildShopContext } from "./context.server";
import { previewSearch } from "./preview.server";
import { executeSearch } from "./search.server";

// Task 5.1 với Typesense thật + model embedding built-in. Cần model trong <data-dir>/models (HUMAN_TODO K1);
// thiếu model (CI không có mạng tới Hugging Face) → skip.
const MODEL = process.env.TYPESENSE_EMBED_MODEL ?? "ts/all-MiniLM-L12-v2";
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

async function modelUp(): Promise<boolean> {
  if (!(await typesenseUp())) return false;
  const name = `emb_probe_${Date.now()}`;
  try {
    await engine.createCollection({
      name,
      fields: [
        { name: "title", type: "string" },
        { name: "embedding", type: "float[]", embed: { from: ["title"], model: MODEL } },
      ],
    });
    await engine.dropCollection(name);
    return true;
  } catch {
    return false;
  }
}

const up = (await postgresUp()) && (await modelUp());

const doc = (id: string, over: Partial<ProductDoc>): ProductDoc => ({
  id,
  gid: `gid://shopify/Product/${id}`,
  handle: `p-${id}`,
  title: "x",
  title_sort: "x",
  vendor: "",
  product_type: "",
  tags: [],
  collections: [],
  collection_handles: [],
  collection_titles: [],
  description_text: "",
  skus: [],
  barcodes: [],
  variant_titles: [],
  option_values: [],
  price_min: 1000,
  price_max: 1000,
  discount_pct: 0,
  on_sale: false,
  available: true,
  inventory_total: 1,
  created_at: 1,
  published_at: 1,
  updated_at: 1,
  variants_json: "[]",
  ...over,
});

describe.skipIf(!up)("AI search, hybrid keyword + embedding (5.1)", () => {
  const domain = `sem-${Date.now()}.myshopify.com`;
  let shopId: string;
  const name = () => productCollection(shopId, 1);
  const ctxFor = async (over: { plan?: string; semanticSearch?: boolean } = {}) => {
    const shop = await testDb().shop.findUniqueOrThrow({ where: { id: shopId } });
    const ctx = await buildShopContext(testDb(), engine, { ...shop, plan: over.plan ?? "pro" });
    return { ...ctx, settings: { ...ctx.settings, semanticSearch: over.semanticSearch ?? true } };
  };
  const search = async (q: string, over?: Parameters<typeof ctxFor>[0]) =>
    executeSearch(await ctxFor(over), { q, locale: "en", filters: {} }, engine);

  beforeAll(async () => {
    shopId = (await ensureShop(testDb(), domain)).shop.id;
    await testDb().shop.update({ where: { id: shopId }, data: { plan: "pro" } });
    await engine.createCollection(
      buildProductSchema({ name: name(), locales: [], metafields: [], semantic: { model: MODEL } }),
    );
    await engine.upsertAlias(productAlias(shopId), name());
    const r = await engine.importDocuments(name(), [
      doc("1", { title: "Leather running shoes", product_type: "Footwear", tags: ["running"] }),
      doc("2", {
        title: "Trail runner",
        product_type: "Footwear",
        vendor: "Fjord",
        tags: ["hiking"],
      }),
      doc("3", { title: "Red summer dress", product_type: "Dresses", tags: ["summer"] }),
      doc("4", { title: "Wool winter beanie", product_type: "Hats", tags: ["winter"] }),
    ]);
    expect(r.failed).toBe(0);
  }, 120_000);

  afterAll(async () => {
    await engine.deleteAlias(productAlias(shopId)).catch(() => undefined);
    await engine.dropCollection(name()).catch(() => undefined);
    await testDb().shop.deleteMany({ where: { domain } });
  });

  it("finds products by meaning when no keyword matches", async () => {
    const r = await search("sneakers");
    expect(r.products.map((p) => p.id).sort()).toEqual(["1", "2"]);
    expect(r.products[0]).not.toHaveProperty("embedding");
  });

  it("keeps keyword matches first and drops unrelated products (distance threshold)", async () => {
    const r = await search("dress");
    expect(r.products.map((p) => p.id)).toEqual(["3"]);
    expect((await search("zzqx")).total).toBe(0);
  });

  it("is keyword-only when turned off or when the plan doesn't include it", async () => {
    expect((await search("sneakers", { semanticSearch: false })).total).toBe(0);
    expect((await search("sneakers", { plan: "growth" })).total).toBe(0);
  });

  it("explains semantic matches in the admin preview", async () => {
    const ctx = await ctxFor();
    const p = await previewSearch(ctx, ctx.settings, "sneakers", engine);
    expect(p.hits.length).toBe(2);
    expect(p.hits.every((h) => typeof h.info.vectorDistance === "number")).toBe(true);
  });

  it("saving: needs Pro, and turning it on re-indexes", async () => {
    const purge = vi.fn(async () => undefined);
    const enqueueFullSync = vi.fn(async () => undefined);
    const s = { ...defaultSearchSettings(), semanticSearch: true };
    const shop = await testDb().shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(
      await saveSearchSettings(testDb(), { ...shop, plan: "growth" }, s, {
        purge,
        enqueueFullSync,
      }),
    ).toEqual({
      ok: false,
      errors: { semanticSearch: "AI search needs the Pro plan or higher" },
    });
    expect(await saveSearchSettings(testDb(), shop, s, { purge, enqueueFullSync })).toEqual({
      ok: true,
      reindex: true,
    });
    expect(
      await saveSearchSettings(
        testDb(),
        shop,
        { ...s, semanticStrictness: "broad" },
        { purge, enqueueFullSync },
      ),
    ).toEqual({
      ok: true,
      reindex: false,
    });
    expect(enqueueFullSync).toHaveBeenCalledTimes(1);
  });
});
