import { expect, test } from "playwright/test";
import { resetDatabase } from "../../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

test("recipe creation, validation, edit, delete confirmation, search, filters, pagination, ordering, toggle, and deep links remain stable", async ({
  page
}) => {
  await page.goto("/recipes/create");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText("Recipe name is required.")).toBeVisible();

  await page.getByLabel("Name").fill("Browser Soup");
  await page.getByLabel("Category").selectOption("entree");
  await page.getByLabel("Servings").fill("6");
  await page.getByLabel("Notes").fill("Desktop characterization");
  await page.getByPlaceholder("2").fill("2");
  await page.getByPlaceholder("cups").fill("cups");
  await page.getByPlaceholder("rice").fill("broth");
  await page.getByRole("button", { name: "Add ingredient" }).click();
  await page.getByPlaceholder("2").nth(1).fill("1");
  await page.getByPlaceholder("cups").nth(1).fill("bunch");
  await page.getByPlaceholder("rice").nth(1).fill("kale");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status")).toContainText("Browser Soup");
  await page.getByRole("link", { name: "View recipe" }).click();
  await expect(page).toHaveURL(/\/recipes\/manage\/\d+$/);
  await expect(page.getByText("Editing recipe")).toBeVisible();
  expect(await page.getByPlaceholder("2 cups rice").evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value)
  )).toEqual([
    "2 cups broth",
    "1 bunch kale"
  ]);

  await page.getByLabel("Name").fill("Browser Stew");
  await page.getByRole("button", { name: "Update recipe" }).click();
  await expect(page.getByRole("status")).toContainText("Browser Stew");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/recipes\/manage$/);

  await expect(page.getByText(/Page 1 of 2/)).toBeVisible();
  await page.getByRole("button", { name: "Next recipe page" }).click();
  await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
  await page.getByPlaceholder("Search by recipe name").fill("Weeknight");
  await expect(page.getByRole("button", { name: "Edit Weeknight Pasta" })).toBeVisible();
  const generationToggle = page.getByRole("button", { name: "Disable menu generation for Weeknight Pasta" });
  await generationToggle.click();
  await expect(page.getByRole("button", { name: "Enable menu generation for Weeknight Pasta" })).toBeVisible();

  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("vegetable_side");
  await expect(page.getByText("No recipes match these filters.")).toBeVisible();
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("all");
  await page.getByPlaceholder("Search by recipe name").fill("");

  await page.getByRole("button", { name: "Edit Browser Stew" }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Delete recipe" }).click();
  await expect(page.getByText("Editing recipe")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete recipe" }).click();
  await expect(page).toHaveURL(/\/recipes\/manage$/);
  await expect(page.getByRole("button", { name: "Edit Browser Stew" })).toHaveCount(0);
});
