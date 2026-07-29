import { expect, test } from "playwright/test";
import { resetDatabase } from "../../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

test("reusable-list creation, validation, conflict, ordering, defaults, edit, delete, and deep links remain stable", async ({
  page
}) => {
  await page.goto("/shopping-lists/create");
  await page.getByRole("button", { name: "Save list" }).click();
  await expect(page.getByText("Shopping list name is required.")).toBeVisible();

  await page.getByLabel("Name").fill("weekly staples");
  await page.getByPlaceholder("Coffee").fill("duplicate");
  await page.getByRole("button", { name: "Save list" }).click();
  await expect(page.locator(".error")).toContainText("UNIQUE");

  await page.getByLabel("Name").fill("Browser Staples");
  await page.getByPlaceholder("Coffee").fill("coffee");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByPlaceholder("Coffee").nth(1).fill("tea");
  await page.getByLabel("Include in new menus by default").check();
  await page.getByRole("button", { name: "Move item up" }).nth(1).click();
  await page.getByRole("button", { name: "Save list" }).click();
  await expect(page.getByRole("status")).toContainText("Browser Staples");
  await page.getByRole("link", { name: "View shopping list" }).click();
  await expect(page).toHaveURL(/\/shopping-lists\/manage\/\d+$/);
  expect(await page.getByRole("textbox", { name: "Coffee" }).evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value)
  )).toEqual(["tea", "coffee"]);

  await page.getByLabel("Name").fill("Browser Pantry");
  await page.getByRole("button", { name: "Update list" }).click();
  await expect(page.getByRole("status")).toContainText("Browser Pantry");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Browser Pantry", { exact: true })).toBeVisible();
  await expect(page.getByText("Included by default", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: /Browser Pantry/ }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Delete list" }).click();
  await expect(page.getByText("Editing shopping list")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete list" }).click();
  await expect(page).toHaveURL(/\/shopping-lists\/manage$/);
  await expect(page.getByText("Browser Pantry", { exact: true })).toHaveCount(0);
});
