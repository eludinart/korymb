# Playwright E2E smoke (optionnel — nécessite serveurs locaux)
# npm --prefix admin run test:e2e

import { test, expect } from "@playwright/test";

test("dashboard répond", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/dashboard");
  await expect(page).toHaveURL(/dashboard/);
});

test("inbox répond", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/inbox");
  await expect(page.getByRole("heading", { name: /Inbox dirigeant/i })).toBeVisible();
});
