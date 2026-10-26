import { AxeBuilder } from "@axe-core/playwright";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockApi, type MockState } from "./mock-api";

// E2E storefront widget (2.9–2.11) trên trang fixture giống theme; API + Storefront API được mock.

async function trackCls(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** Lỗi JS (không tính dòng "Failed to load resource" do trình duyệt tự in khi API trả 503). */
function jsErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const seriousViolations = async (page: Page, include?: string) => {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes[0]?.html}`);
};

test.describe("instant search", () => {
  test("shows a combobox dropdown, supports the keyboard, passes axe", async ({ page }) => {
    await mockApi(page);
    const errors = jsErrors(page);
    await page.goto("/search.html");
    const input = page.locator("#q");
    await input.fill("sh");
    const box = page.getByRole("listbox");
    await expect(box).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(box.getByRole("option", { name: /Shirt classic/ }).first()).toBeVisible();
    await expect(box.getByRole("option", { name: "Summer" })).toBeVisible();
    await input.press("ArrowDown");
    const activeId = await input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");
    expect(await seriousViolations(page, ".sa-ac")).toEqual([]);
    await input.press("Escape");
    await expect(box).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("Enter on an active product navigates to it; Enter without selection submits the native form", async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto("/search.html");
    const input = page.locator("#q");
    await input.fill("sh");
    await expect(page.getByRole("listbox")).toBeVisible();
    await input.press("ArrowDown");
    await input.press("ArrowDown");
    await Promise.all([page.waitForURL(/\/products\//), input.press("Enter")]);
    await page.goto("/search.html");
    await page.locator("#q").fill("zz");
    await Promise.all([page.waitForURL(/search\.html\?q=zz/), page.locator("#q").press("Enter")]);
  });
});

// Mobile: filter nằm trong bottom sheet (mở bằng nút "Filters"); facet là accordion.
const sheetOpen = (block: Locator) => block.locator(".sa-filters__panel[role=dialog]");
async function openFacet(block: Locator, key: string) {
  if ((await block.locator("[data-sheet-open]").isVisible()) && !(await sheetOpen(block).count()))
    await block.locator("[data-sheet-open]").click();
  const d = block.locator(`details.sa-facet[data-key="${key}"]`);
  if ((await d.getAttribute("open")) === null) await d.locator("summary").click();
}
async function closeSheet(block: Locator) {
  if (await sheetOpen(block).count())
    await block.locator(".sa-filters__foot [data-sheet-close]").click();
}

test.describe("results page", () => {
  test("hydrates the native grid, filters/sorts/paginates via native URL params, no CLS, passes axe", async ({
    page,
  }) => {
    await trackCls(page);
    const state = await mockApi(page);
    const errors = jsErrors(page);
    await page.goto("/search.html?q=");
    const block = page.locator(".sa-block");
    await expect(block.locator(".sa-grid .sa-card")).toHaveCount(2);
    await expect(block.locator("[data-native-results]")).toHaveCount(0);
    await expect(block.locator(".sa-total")).toHaveText("5 results");

    await openFacet(block, "vendor");
    await block.getByRole("checkbox", { name: /Nike/ }).check();
    await expect(page).toHaveURL(/filter\.p\.vendor=Nike/);
    await expect(block.locator(".sa-total")).toHaveText("3 results");
    await closeSheet(block);
    await expect(block.getByRole("button", { name: /Nike ×/ })).toBeVisible();

    await block.getByLabel("Sort by").selectOption("price_desc");
    await expect(page).toHaveURL(/sort_by=price_desc/);
    await expect(block.locator(".sa-card__title").first()).toHaveText("Shoes runner");

    await block
      .getByRole("navigation", { name: "Pagination" })
      .getByRole("link", { name: "2", exact: true })
      .click();

    await expect(page).toHaveURL(/page=2/);
    await expect(block.locator(".sa-pagination [aria-current]")).toHaveText("2");

    // Price: thanh trượt 2 đầu, không ô nhập tay; nhãn giá trị theo tiền tệ.
    await openFacet(block, "price");
    await expect(block.locator("form.sa-range input:not([type=range])")).toHaveCount(0);
    await expect(block.locator("form.sa-range output").first()).toHaveText("$19");
    const minThumb = block.locator('form.sa-range input[type="range"]').first();
    await minThumb.focus();
    await minThumb.press("ArrowRight");
    await expect(page).toHaveURL(/filter\.v\.price\.gte=20/);
    await expect(block.locator("form.sa-range output").first()).toHaveText("$20");
    // Sau khi tải lại, focus vẫn ở đầu "min" → bấm tiếp được (bàn phím); khoảng giá không co lại.
    await expect(minThumb).toBeFocused();
    await expect(block.locator("form.sa-range output").nth(1)).toHaveText("$90");

    await page.goBack();
    await expect(page).not.toHaveURL(/filter\.v\.price\.gte/);

    // Thanh trượt 2 đầu: kéo đầu max sang trái (bàn phím) → lọc price.lte, ô số đi theo.
    const maxThumb = block.locator('form.sa-range input[type="range"]').nth(1);
    await maxThumb.focus();
    await maxThumb.press("ArrowLeft");
    await expect(page).toHaveURL(/filter\.v\.price\.lte=/);
    await page.goBack();
    await closeSheet(block);

    expect(await seriousViolations(page, ".sa-block")).toEqual([]);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
    expect(state.storefrontCalls).toBe(0); // cùng currency: không gọi Storefront API
    expect(errors).toEqual([]);
  });

  test("desktop: facets are accordions in a sticky column", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop layout");
    await mockApi(page);
    await page.goto("/search.html?q=");
    const block = page.locator(".sa-block");
    const brand = block.locator('details.sa-facet[data-key="vendor"]');
    await expect(brand).toHaveAttribute("open", "");
    await brand.locator("summary").click();
    await expect(block.getByRole("checkbox", { name: /Nike/ })).toBeHidden();
    await brand.locator("summary").click();
    await block.getByRole("checkbox", { name: /Nike/ }).check();
    // Đóng/mở giữ nguyên qua lần render lại; badge đếm lựa chọn trên tiêu đề.
    await expect(brand.locator(".sa-badge-count")).toHaveText("1");
    await expect(brand).toHaveAttribute("open", "");
    expect(await block.locator(".sa-filters").evaluate((e) => getComputedStyle(e).position)).toBe(
      "sticky",
    );
    await expect(block.locator("[data-sheet-open]")).toBeHidden();
  });

  test("mobile: Filters button opens a bottom sheet with Show N products and Reset", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "mobile layout");
    await mockApi(page);
    const errors = jsErrors(page);
    await page.goto("/search.html?q=");
    const block = page.locator(".sa-block");
    const button = block.getByRole("button", { name: "Filters" });
    await expect(block.locator(".sa-filters")).toBeHidden();
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Filters" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect(page.locator("html")).toHaveClass(/sa-lock/);
    // Accordion đóng sẵn trong sheet; mở Brand, chọn → kết quả + nút đếm cập nhật ngay.
    await dialog.locator('details[data-key="vendor"] summary').click();
    await dialog.getByRole("checkbox", { name: /Nike/ }).check();
    await expect(page).toHaveURL(/filter\.p\.vendor=Nike/);
    await expect(dialog.getByRole("button", { name: "Show 3 products" })).toBeVisible();
    expect(await seriousViolations(page, ".sa-filters")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button.locator(".sa-badge-count")).toHaveText("1");
    await button.click();
    await dialog.getByRole("button", { name: "Reset filters" }).click();
    await expect(page).not.toHaveURL(/filter\.p\.vendor/);
    await dialog.getByRole("button", { name: /^Show \d+ products$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("html")).not.toHaveClass(/sa-lock/);
    expect(errors).toEqual([]);
  });

  test("collection block uses the collection endpoint", async ({ page }) => {
    await mockApi(page);
    await page.goto("/collection.html");
    await expect(page.locator(".sa-block .sa-card")).toHaveCount(2);
    await expect(page.locator(".sa-block .sa-total")).toHaveText("5 results");
    await expect(page.locator(".sa-block")).not.toHaveClass(/sa-pending/); // skeleton đã gỡ
  });
});

test.describe("market pricing (D15)", () => {
  test("EUR buyer: exactly one Storefront request per results load, € prices, unsold products hidden", async ({
    page,
  }) => {
    const state: MockState = { storefrontCalls: 0, searchCalls: 0 };
    await mockApi(page, state);
    await page.goto("/search.html?currency=EUR&q=");
    const block = page.locator(".sa-block");
    await expect(block.locator(".sa-card").first()).toBeVisible();
    await expect(block.locator(".sa-card__price").first()).toHaveText("17,10 €");
    expect(state.storefrontCalls).toBe(1);
    await block.getByLabel("Sort by").selectOption("price_desc");
    await expect(block.locator(".sa-card__title").first()).toHaveText("Shoes runner");
    expect(state.storefrontCalls).toBe(2); // mỗi lần tải kết quả đúng 1 request
    await expect(block.getByText("Shirt classic")).toHaveCount(0); // không bán ở DE
  });
});

test.describe("fallback (2.11)", () => {
  test("engine down → native products stay, no JS errors", async ({ page }) => {
    const state: MockState = { storefrontCalls: 0, searchCalls: 0, fail: true };
    await mockApi(page, state);
    const errors = jsErrors(page);
    await page.goto("/search.html?q=tee");
    await page.waitForTimeout(500);
    await expect(page.locator("[data-native-results] li")).toHaveCount(2);
    await page.locator("#q").fill("tee");
    await Promise.all([page.waitForURL(/search\.html\?q=tee/), page.locator("#q").press("Enter")]);
    expect(errors).toEqual([]);
  });
});

test.describe("fallback: network failures", () => {
  test("search API unreachable (aborted) → native grid stays, no JS errors", async ({ page }) => {
    const errors = jsErrors(page);
    await page.route("**/apps/search/v1/**", (route) => route.abort("connectionrefused"));
    await page.goto("/search.html?q=tee");
    await page.waitForTimeout(500);
    await expect(page.locator("[data-native-results] li")).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("Storefront API failing → amounts hidden ('View price'), never a wrong currency", async ({
    page,
  }) => {
    await mockApi(page);
    await page.unroute("**/api/2026-10/graphql.json");
    await page.route("**/api/2026-10/graphql.json", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await page.goto("/search.html?currency=EUR&q=");
    const block = page.locator(".sa-block");
    await expect(block.locator(".sa-card").first()).toBeVisible();
    await expect(block.locator(".sa-card__price").first()).toHaveText("View price");
    await expect(block.locator(".sa-card__price", { hasText: "$" })).toHaveCount(0);
  });
});

test("collection: adopts the native grid when the API returns the same products in the same order (no repaint)", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/collection.html");
  const block = page.locator(".sa-block");
  await expect(block.locator(".sa-total")).toBeVisible();
  // Grid native được giữ nguyên (cùng phần tử DOM, có data-native-results) thay vì vẽ lại.
  await expect(block.locator("[data-native-results] [data-sa-id]")).toHaveCount(2);
  await openFacet(block, "vendor");
  await block.getByRole("checkbox", { name: /Nike/ }).check();
  await expect(block.locator("[data-native-results]")).toHaveCount(0); // thao tác → vẽ lại bằng widget
});

test("query understanding: words become removable filters, with a 'search instead' link (5.2)", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/search.html?q=nike%20shoes");
  const block = page.locator(".sa-block");
  // Mock khớp tiền tố "sho" → 2 sản phẩm, đều của Nike (filter đã hiểu được áp).
  await expect(block.locator(".sa-card")).toHaveCount(2);
  await expect(block.locator(".sa-card", { hasNotText: "Nike" })).toHaveCount(0);
  // URL mang filter đã hiểu → khách bỏ được như filter thường.
  await expect.poll(() => new URL(page.url()).searchParams.get("filter.p.vendor")).toBe("Nike");
  expect(new URL(page.url()).searchParams.get("q")).toBe("shoes");
  await expect(block.locator(".sa-chip", { hasText: "Nike" })).toBeVisible();
  const instead = block.getByRole("link", { name: "Search for “nike shoes” instead" });
  await expect(instead).toBeVisible();
  await instead.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("sa_literal")).toBe("1");
  await expect(block.locator(".sa-note")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("q")).toBe("nike shoes");
});
