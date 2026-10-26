import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Task 3.10: mọi trang admin (en + vi) trên desktop và mobile (project "mobile" = Pixel 7): không tràn ngang,
// CLS < 0.1, LCP ≤ 2.5 s (ngưỡng BFS Admin Web Vitals). Trang do e2e/admin/render.tsx tạo (Polaris từ CDN Shopify);
// không có mạng tới cdn.shopify.com → bỏ qua. Kiểm tra thật trong Shopify admin (2 giao diện) ở HUMAN_TODO I1.

const pages: string[] = JSON.parse(readFileSync("e2e/fixtures/admin/index.json", "utf8"));

test.describe("admin pages layout & vitals", () => {
  test.beforeAll(async ({ request }) => {
    const ok = await request
      .head("https://cdn.shopify.com/shopifycloud/polaris.js", { timeout: 5000 })
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!ok, "cdn.shopify.com unreachable");
  });

  for (const name of pages) {
    test(name, async ({ page }, info) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number; __lcp: number };
        w.__cls = 0;
        w.__lcp = 0;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[])
            if (!e.hadRecentInput) w.__cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) w.__lcp = Math.max(w.__lcp, e.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/admin/${name}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => Boolean(customElements.get("s-page")));
      await page.waitForTimeout(500);

      const m = await page.evaluate(() => {
        const w = window as unknown as { __cls: number; __lcp: number };
        // Phần tử nào vượt mép phải viewport (chẩn đoán khi fail).
        const vw = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll("body *")]
          .filter(
            (el) => el.getBoundingClientRect().right > vw + 1 && !el.closest("pre,iframe,s-table"),
          )
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
        return {
          overflow: document.documentElement.scrollWidth - vw,
          wide,
          cls: w.__cls,
          lcp: w.__lcp,
        };
      });
      mkdirSync("test-results", { recursive: true });
      appendFileSync(
        "test-results/admin-vitals.jsonl",
        JSON.stringify({ page: name, project: info.project.name, cls: m.cls, lcp: m.lcp }) + "\n",
      );
      expect(errors, "page errors").toEqual([]);
      expect(m.overflow, `horizontal overflow: ${m.wide.join(", ")}`).toBeLessThanOrEqual(1);
      expect(m.cls, "CLS").toBeLessThan(0.1);
      expect(m.lcp, "LCP ms").toBeLessThanOrEqual(2500);
    });
  }
});
