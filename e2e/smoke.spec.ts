import { expect, test } from "@playwright/test";

test("fixture server is up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fixture storefront" })).toBeVisible();
});
