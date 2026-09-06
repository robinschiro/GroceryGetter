import { expect, test } from "playwright/test";
import { resetDatabase } from "../../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

test("phone navigation opens and closes, reaches every primary view, shows data mode, and avoids major overflow", async ({
  page
}) => {
  await page.goto("/planner");
  const menuButton = page.getByRole("button", { name: "Open navigation menu" });
  await expect(menuButton).toBeVisible();

  const destinations = [
    ["Planner", "/planner", "Menu Builder"],
    ["Menu History", "/menus", "Menu History"],
    ["Recipes", "/recipes/manage", "Recipes"],
    ["Shopping Lists", "/shopping-lists/manage", "Shopping Lists"],
    ["Ingredients", "/ingredients", "Ingredients"],
    ["QFC Settings", "/settings/qfc/api", "QFC Settings"],
    ["OurGroceries", "/settings/ourgroceries", "OurGroceries Settings"]
  ] as const;
  for (const [label, route, heading] of destinations) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(page.getByRole("button", { name: "Close navigation menu" })).toBeVisible();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}$`));
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 3 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - window.innerWidth,
      body: document.body.scrollWidth - window.innerWidth
    }));
    expect(Math.max(overflow.document, overflow.body)).toBeLessThanOrEqual(2);
  }

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  await page.getByRole("tab", { name: "Add Recipe" }).click();
  const ingredientHeaders = page.locator(".ingredient-column-headers");
  await expect(ingredientHeaders).toBeHidden();
  const ingredientEditor = page.locator(".ingredient-editor");
  const ingredientCard = ingredientEditor.locator(".ingredient-card").first();
  const removeIngredient = ingredientCard.getByRole("button", { name: "Remove ingredient 1" });
  await expect(removeIngredient).toBeVisible();
  expect(await ingredientCard.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe("solid");
  for (const label of ["Quantity", "Unit", "Name"]) {
    const mobileLabel = ingredientEditor.locator(".ingredient-mobile-label", { hasText: label });
    const field = ingredientEditor.getByLabel(`${label} for ingredient 1`);
    await expect(mobileLabel).toBeVisible();
    await expect(field).toBeVisible();
    expect(await mobileLabel.evaluate((element) => getComputedStyle(element).color)).toBe(
      await ingredientHeaders.evaluate((element) => getComputedStyle(element).color)
    );
    const [labelBox, fieldBox] = await Promise.all([mobileLabel.boundingBox(), field.boundingBox()]);
    expect(labelBox).not.toBeNull();
    expect(fieldBox).not.toBeNull();
    const labelCenter = (labelBox?.y ?? 0) + (labelBox?.height ?? 0) / 2;
    const fieldCenter = (fieldBox?.y ?? 0) + (fieldBox?.height ?? 0) / 2;
    expect(Math.abs(labelCenter - fieldCenter)).toBeLessThan(2);
  }
  const [removeBox, quantityBox] = await Promise.all([
    removeIngredient.boundingBox(),
    ingredientEditor.getByLabel("Quantity for ingredient 1").boundingBox()
  ]);
  expect((removeBox?.y ?? Infinity)).toBeLessThan(quantityBox?.y ?? 0);
  const recipeOverflow = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollWidth - window.innerWidth,
      document.body.scrollWidth - window.innerWidth
    )
  );
  expect(recipeOverflow).toBeLessThanOrEqual(2);

  await page.getByLabel("Data mode").selectOption("sandbox");
  await expect(page.getByRole("status").filter({ hasText: "Sandbox mode" })).toBeVisible();
});
