import { expect, test, type Page } from "@playwright/test";
import { config, mockApi } from "./mock-api";

// Task 6.3: dữ liệu catalog (tên sản phẩm, vendor, giá trị facet, nhãn sort), từ khoá trên URL và sa_orig đều là
// đầu vào không tin cậy. Widget dựng HTML bằng chuỗi → mọi chỗ chèn phải được escape. Không được có dialog,
// không phần tử có handler on*, không <script> inline, không href javascript:.
const P = [
  `"><img src=x onerror=alert(1)>`,
  `<svg onload=alert(2)>`,
  `' onmouseover='alert(3)`,
  `javascript:alert(4)`,
  `</style><script>alert(5)</script>`,
  `red;background:url(javascript:alert(6))`,
];

const product = (i: number) => ({
  id: String(i),
  gid: `gid://shopify/Product/${i}`,
  handle: `p-${i}`,
  url: i === 0 ? P[3] : `/products/${i}`,
  title: P[i % P.length],
  vendor: P[(i + 1) % P.length],
  product_type: "",
  image: `https://cdn.example/x.jpg?${P[0]}`,
  image_alt: P[1],
  available: true,
  price_min: 1000,
  price_max: 1000,
  discount_pct: 0,
  on_sale: false,
  currency: "USD",
  tags: [],
  variants: [],
  badges: [P[2]],
});

async function hostileApi(page: Page) {
  await mockApi(page);
  const results = {
    query: P[0],
    redirect: null,
    total: 6,
    page: 1,
    per_page: 24,
    sort: "relevance",
    sort_options: [{ key: P[2], label: P[4] }],
    products: Array.from({ length: 6 }, (_, i) => product(i)),
    facets: [
      {
        key: "vendor",
        label: P[1],
        type: "checkbox",
        param: "filter.p.vendor",
        values: P.map((v) => ({ value: v, count: 1, selected: true })),
        collapsed: false,
        showCount: true,
      },
      {
        key: "color",
        label: "Color",
        type: "swatch",
        param: "filter.v.option.color",
        values: [{ value: P[5], count: 1, selected: false }],
        collapsed: false,
        showCount: true,
      },
    ],
    applied_filters: {},
    currency: "USD",
    interpreted: { query: P[0], original: P[4], filters: {} },
  };
  await page.route("**/apps/search/v1/search**", (r) => r.fulfill({ json: results }));
  await page.route("**/apps/search/v1/suggest**", (r) =>
    r.fulfill({
      json: {
        // Instant bỏ qua response không khớp ô nhập (chống race) → trả đúng q đã gõ.
        query: new URL(r.request().url()).searchParams.get("q"),
        products: [product(1), product(2)],
        collections: [{ title: P[1], url: P[3], handle: "x" }],
        pages: [{ title: P[4], url: "/pages/x" }],
        articles: [],
        suggestions: [P[0], P[2]],
        total_products: 2,
        currency: "USD",
      },
    }),
  );
}

async function assertClean(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      for (const a of el.getAttributeNames()) if (/^on/i.test(a)) out.push(`${el.tagName} ${a}`);
      const href = el.getAttribute("href");
      if (href && /^\s*javascript:/i.test(href)) out.push(`${el.tagName} href=${href}`);
    }
    for (const s of document.querySelectorAll("script:not([src])"))
      if (/alert\(/.test(s.textContent ?? "")) out.push("inline script");
    return out;
  });
  expect(bad).toEqual([]);
}

test("results widget escapes hostile catalog data and URL params (6.3)", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await hostileApi(page);
  await page.goto(`/search.html?q=${encodeURIComponent(P[0])}&sa_orig=${encodeURIComponent(P[4])}`);
  await expect(page.locator(".sa-block .sa-card")).toHaveCount(6);
  await expect(page.locator(".sa-block .sa-card__title").first()).toHaveText(P[0]);
  await expect(page.locator(".sa-note a")).toContainText(P[4]);
  await assertClean(page);
  // Product URL "javascript:…" từ API không thành link chạy được.
  await page.locator(".sa-card a").first().hover();
  expect(dialogs).toEqual([]);
});

test("instant search escapes hostile suggestions (6.3)", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await hostileApi(page);
  await page.goto("/search.html");
  await page.locator("#q").fill("sh");
  // Phạm vi dropdown instant: trang cũng có <select> sort (option ẩn) từ widget kết quả.
  const box = page.locator(".sa-ac");
  await expect(box, errors.join("\n")).toBeVisible();
  await expect(box.getByRole("option").first()).toBeVisible();
  await assertClean(page);
  expect(dialogs).toEqual([]);
});

test("a hostile merchant template stored before validation is defused by the SDK (6.3)", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await hostileApi(page);
  // Config hợp lệ của mock + template độc (qua mặt regex cũ): "<img/onerror=…>".
  await page.route("**/apps/search/v1/config**", (r) =>
    r.fulfill({
      json: {
        ...config,
        templates: {
          "product-card": '<li class="sa-card"><img/onerror=alert(7) src=x>{{title}}</li>',
        },
      },
    }),
  );
  await page.goto("/search.html?q=x");
  await expect(page.locator(".sa-block .sa-card")).toHaveCount(6);
  await page.waitForTimeout(300);
  await assertClean(page);
  expect(dialogs).toEqual([]);
});
