import { test, expect } from "@playwright/test";

test("accueil public", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Korymb, votre activité/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Créer un espace/i }).first()).toBeVisible();
});

test("page de connexion Korymb", async ({ page }) => {
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

test("vitrine publique sans session", async ({ page }) => {
  await page.goto("/p/eludein");
  await expect(page).not.toHaveURL(/\/login/);
});

test("espace participant sans session redirige vers la connexion participant", async ({ page }) => {
  await page.goto("/a/eludein");
  await expect(page).toHaveURL(/\/p\/eludein\/connexion/);
});

test("compte participant sans session redirige vers la connexion participant", async ({ page }) => {
  await page.goto("/a/eludein/compte");
  await expect(page).toHaveURL(/\/p\/eludein\/connexion/);
});
