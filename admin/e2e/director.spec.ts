import { test, expect } from "@playwright/test";

test("cockpit dirigeant sans session ouvre la landing", async ({ page }) => {
  for (const path of ["/dashboard", "/missions", "/carte", "/gestion/playbooks", "/gestion/studio", "/gestion/livrables", "/gestion"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/\?next=/);
    await expect(page.getByRole("heading", { name: /Vous dites quoi faire/i })).toBeVisible();
  }
});
