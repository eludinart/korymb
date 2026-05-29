# Playwright E2E — parcours dirigeant
# npm --prefix admin run test:e2e

import { test, expect } from "@playwright/test";

test("briefing répond", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/briefing");
  await expect(page.getByRole("heading", { name: /Briefing dirigeant/i })).toBeVisible();
});

test("inbox actionnable répond", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/inbox");
  await expect(page.getByRole("heading", { name: /Inbox dirigeant/i })).toBeVisible();
});

test("playbooks administration", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/administration/playbooks");
  await expect(page.getByRole("heading", { name: /Playbooks métier/i })).toBeVisible();
});
