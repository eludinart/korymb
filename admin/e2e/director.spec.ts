import { test, expect } from "@playwright/test";

test("cockpit dirigeant reste derrière le login", async ({ page }) => {
  for (const path of ["/dashboard", "/missions", "/carte", "/gestion/playbooks", "/gestion/studio", "/gestion/livrables", "/gestion"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /^Connexion$/i })).toBeVisible();
  }
});
