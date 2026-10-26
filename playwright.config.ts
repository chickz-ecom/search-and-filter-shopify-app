import { defineConfig, devices } from "@playwright/test";

// E2E chạy trên trang fixture tĩnh (giả lập theme storefront + search-api mock),
// không cần store Shopify thật. Xem e2e/server.mjs.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npx tsx e2e/admin/render.tsx && node e2e/server.mjs",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
