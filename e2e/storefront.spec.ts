import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
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

    await block.getByRole("checkbox", { name: /Nike/ }).check();
    await expect(page).toHaveURL(/filter\.p\.vendor=Nike/);
    await expect(block.locator(".sa-total")).toHaveText("3 results");
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

    await block.locator('form.sa-range input[name="min"]').fill("20");
    await block.locator("form.sa-range").getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/filter\.v\.price\.gte=20/);

    await page.goBack();
    await expect(page).not.toHaveURL(/filter\.v\.price\.gte/);

    expect(await seriousViolations(page, ".sa-block")).toEqual([]);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
    expect(state.storefrontCalls).toBe(0); // cùng currency: không gọi Storefront API
    expect(errors).toEqual([]);
  });

  test("collection block uses the collection endpoint", async ({ page }) => {
    await mockApi(page);
    await page.goto("/collection.html");
    await expect(page.locator(".sa-block .sa-card")).toHaveCount(2);
    await expect(page.locator(".sa-block .sa-total")).toHaveText("5 results");
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
  await block.getByRole("checkbox", { name: /Nike/ }).check();
  await expect(block.locator("[data-native-results]")).toHaveCount(0); // thao tác → vẽ lại bằng widget
});
