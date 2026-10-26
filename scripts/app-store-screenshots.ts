// Ảnh chụp cho hồ sơ App Store (task 6.5): 1600×900 (16:9), không khung trình duyệt, không giá/số liệu/logo Shopify.
// Chụp từ chính component admin (e2e/admin/render.tsx, Polaris CDN) + trang storefront fixture.
//   LISTING=1 npx tsx e2e/admin/render.tsx && (node e2e/server.mjs &) && npx tsx scripts/app-store-screenshots.ts
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const SHOTS = [
  { file: "01-home.png", url: "/admin-listing/home.en.html" },
  { file: "02-search-settings.png", url: "/admin-listing/search.en.html" },
  { file: "03-filters.png", url: "/admin-listing/filters.en.html" },
  { file: "04-merchandising.png", url: "/admin-listing/merchandising-rules.en.html" },
  { file: "05-appearance.png", url: "/admin-listing/appearance.en.html" },
  { file: "06-analytics.png", url: "/admin-listing/analytics.en.html" },
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});
for (const s of SHOTS) {
  await page.goto(BASE + s.url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(customElements.get("s-page")));
  // Lưu bar App Bridge không có ngoài admin thật → ẩn nút thô của ui-save-bar.
  await page.addStyleTag({
    content: "ui-save-bar{display:none!important} body{background:#f1f1f1}",
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `docs/app-store/screenshots/${s.file}` });
  console.log("saved", s.file);
}
await browser.close();
