import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Liquid, Tag, type TagToken, type TopLevelToken } from "liquidjs";
import { mockApi } from "./mock-api";

// Task 4.2: ba section mẫu trong docs/developers/examples render bằng Liquid (liquidjs) rồi chạy với SDK thật trên
// trang fixture (API mock). Kiểm tra: tự chạy, phối hợp với nhau và với widget kết quả có sẵn qua URL state.

const engine = new Liquid();
// {% schema %} chỉ dành cho theme editor: bỏ qua nội dung khi render.
engine.registerTag(
  "schema",
  class extends Tag {
    constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
      super(token, remain, liquid);
      while (remain.length) {
        const t = remain.shift()!;
        if (t.kind === 4 && (t as TagToken).name === "endschema") break;
      }
    }
    *render() {}
  },
);

function section(name: string, id: string): string {
  const src = readFileSync(`docs/developers/examples/${name}.liquid`, "utf8");
  const schema = JSON.parse(src.match(/{% schema %}([\s\S]*?){% endschema %}/)![1]);
  const settings = Object.fromEntries(
    (schema.settings as { id: string; default?: unknown }[]).map((s) => [s.id, s.default]),
  );
  return engine.parseAndRenderSync(src, { section: { id, settings } });
}

function pageHtml(body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/searchapp.css"><title>Examples</title></head>
<body data-page="search"><main>${body}</main>
<script src="/theme.js"></script>
<script src="/assets/searchapp-sdk.js" defer></script>
<script src="/assets/searchapp-results.js" defer></script></body></html>`;
}

async function open(page: Page, body: string, query = "?q=") {
  await mockApi(page);
  await page.route("**/examples.html*", (r) =>
    r.fulfill({ contentType: "text/html", body: pageHtml(body) }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/examples.html${query}`);
  return errors;
}

test("all example sections render valid Liquid with their schema defaults", () => {
  for (const name of ["custom-grid", "horizontal-filters", "sort-dropdown"]) {
    const html = section(name, "x1");
    expect(html).not.toContain("{%");
    expect(html).toContain("x1");
  }
  // Placeholder của template SDK được giữ nguyên nhờ {% raw %}.
  expect(section("custom-grid", "x1")).toContain('href="{{url}}"');
});

test("custom grid + horizontal filters + sort dropdown work together through the URL", async ({
  page,
}) => {
  const errors = await open(
    page,
    section("horizontal-filters", "f1") +
      section("sort-dropdown", "s1") +
      section("custom-grid", "g1"),
  );
  const grid = page.locator("#ex-grid-g1 .ex-grid__list > li");
  await expect(grid).toHaveCount(5);
  await expect(page.locator("#ex-grid-g1 .ex-grid__count")).toHaveText("5 products");

  // Filter ngang: chọn Brand = Nike → URL + grid đổi.
  await page.locator('#ex-filters-f1 details[data-facet="vendor"] summary').click();
  await page.locator('#ex-filters-f1 input[data-key="vendor"][value="Nike"]').check();
  await expect(grid).toHaveCount(3);
  expect(new URL(page.url()).searchParams.getAll("filter.p.vendor")).toEqual(["Nike"]);
  await expect(page.locator("#ex-filters-f1 .ex-filters__chips button").first()).toHaveText(
    "Nike ×",
  );

  // Sort riêng: giá tăng dần.
  await page.locator("#ex-sort-select-s1").selectOption("price_asc");
  await expect(grid.first()).toContainText("Red tee");
  await expect(grid.last()).toContainText("Shoes runner");
  expect(new URL(page.url()).searchParams.get("sort_by")).toBe("price_asc");

  // Bỏ chip → về đủ sản phẩm.
  await page.locator("#ex-filters-f1 .ex-filters__chips button[data-clear]").click();
  await expect(grid).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("custom grid paginates with Load more", async ({ page }) => {
  const errors = await open(
    page,
    section("custom-grid", "g1").replace('data-per-page="12"', 'data-per-page="2"'),
  );
  const grid = page.locator("#ex-grid-g1 .ex-grid__list > li");
  await expect(grid).toHaveCount(2);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(grid).toHaveCount(4);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(grid).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();
  expect(errors).toEqual([]);
});

test("filters and sort sections drive the built-in results widget", async ({ page }) => {
  const errors = await open(
    page,
    section("horizontal-filters", "f1") +
      section("sort-dropdown", "s1") +
      '<div data-searchapp-mount="results" data-per-page="24" data-filter-position="none" data-show-sort="false"></div>',
  );
  const cards = page.locator("[data-searchapp-mount] .sa-card");
  await expect(cards).toHaveCount(5);
  // Widget không tự vẽ filter/sort (theme tự dựng).
  await expect(page.locator("[data-searchapp-mount] .sa-filters")).toHaveCount(0);
  await expect(page.locator("[data-searchapp-mount] select[name=sort_by]")).toHaveCount(0);

  await page.locator('#ex-filters-f1 details[data-facet="availability"] summary').click();
  await page.locator("#ex-filters-f1 input[data-toggle=availability]").check();
  await expect(cards).toHaveCount(4);
  await page.locator("#ex-sort-select-s1").selectOption("price_desc");
  await expect(cards.first()).toContainText("Shoes runner");
  expect(errors).toEqual([]);
});
