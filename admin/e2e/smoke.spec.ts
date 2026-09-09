import { test, expect } from "@playwright/test";

test("accueil public", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Votre Korymb/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Se connecter/i })).toBeVisible();
});

test("page de connexion", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /^Connexion$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Se connecter$/i })).toBeVisible();
});

test("inbox sans session redirige vers login", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /^Connexion$/i })).toBeVisible();
});

test("briefing sans session redirige vers login", async ({ page }) => {
  await page.goto("/briefing");
  await expect(page).toHaveURL(/\/login/);
});
