import { afterAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { DEFAULT_FILTERS, type FilterItem } from "../config/filters";
import { ensureShop } from "../shop/shop.server";
import { loadFiltersForm, saveFilters } from "./filters.server";

const up = await postgresUp();
const item = (over: Partial<FilterItem>): FilterItem => ({
  id: "x",
  source: "vendor",
  label: { en: "X" },
  display: "checkbox",
  enabled: true,
  position: 0,
  collapsed: false,
  showCount: true,
  maxValues: 20,
  sortValues: "count",
  matchAll: false,
  ...over,
});

describe.skipIf(!up)("Filters page backend (3.4)", () => {
  const domain = `flt-${Date.now()}.myshopify.com`;
  afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

  it("saves default, search and per-collection trees; metafield filters queue a re-index; inline errors", async () => {
    const { shop } = await ensureShop(testDb(), domain);
    const purge = vi.fn(async () => undefined);
    const enqueueFullSync = vi.fn(async () => undefined);
    const form = await loadFiltersForm(testDb(), shop.id);
    expect(form.default.map((f) => f.id)).toEqual(DEFAULT_FILTERS.map((f) => f.id));
    expect(form.search).toBeNull();

    const bad = {
      ...form,
      default: [...form.default, item({ id: "size", source: "option", display: "checkbox" })],
    };
    const r1 = await saveFilters(testDb(), shop, bad, { purge, enqueueFullSync });
    expect(r1).toEqual({
      ok: false,
      errors: { "default.4.optionName": "Option name is required" },
    });

    const good = {
      default: [...form.default, item({ id: "size", source: "option", optionName: "Size" })],
      search: [item({ id: "vendor", source: "vendor" })],
      collections: {
        "77": [item({ id: "material", source: "metafield", metafield: "custom.material" })],
      },
    };
    expect(await saveFilters(testDb(), shop, good, { purge, enqueueFullSync })).toEqual({
      ok: true,
      reindex: true,
    });
    expect(enqueueFullSync).toHaveBeenCalledTimes(1);
    const reload = await loadFiltersForm(testDb(), shop.id);
    expect(reload.default.map((f) => f.id)).toEqual([...DEFAULT_FILTERS.map((f) => f.id), "size"]);
    expect(reload.search?.map((f) => f.id)).toEqual(["vendor"]);
    expect(Object.keys(reload.collections)).toEqual(["77"]);
    // Lưu lại không đổi metafield → không re-index.
    expect(await saveFilters(testDb(), shop, reload, { purge, enqueueFullSync })).toEqual({
      ok: true,
      reindex: false,
    });
  });
});
