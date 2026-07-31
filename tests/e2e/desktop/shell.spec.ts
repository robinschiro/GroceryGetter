import { expect, test } from "playwright/test";
import { resetDatabase } from "../../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

test("direct routes, navigation, history, refresh, theme, data mode, and scope isolation remain stable", async ({
  page
}) => {
  const directRoutes = [
    ["/planner", "Menu Builder"],
    ["/menus", "Menu History"],
    ["/recipes/manage", "Recipes"],
    ["/recipes/create", "Recipes"],
    ["/shopping-lists/manage", "Shopping Lists"],
    ["/shopping-lists/create", "Shopping Lists"],
    ["/settings/qfc/api", "QFC Settings"],
    ["/settings/qfc/preferences", "QFC Settings"]
  ] as const;
  for (const [route, heading] of directRoutes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 3 })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(route);
  }

  await page.goto("/planner");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  await expect(page).toHaveURL(/\/recipes\/manage$/);
  await page.getByRole("tab", { name: "Add Recipe" }).click();
  await expect(page).toHaveURL(/\/recipes\/create$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/recipes\/manage$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/recipes\/create$/);
  await page.getByRole("tab", { name: "Manage Recipes" }).click();

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("grocery-getter-theme"))).toBe("dark");

  const recipesResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/recipes") && response.request().method() === "GET"
  );
  await page.getByRole("button", { name: "Refresh data" }).click();
  await recipesResponse;

  await page.getByLabel("Data mode").selectOption("sandbox");
  await expect(page.getByRole("status").filter({ hasText: "Sandbox mode" })).toBeVisible();
  await expect(page.getByText("Sandbox Tacos", { exact: true })).toBeVisible();
  await expect(page.getByText("Entree 02", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("grocery-getter-data-scope"))).toBe("sandbox");

  await page.getByLabel("Data mode").selectOption("production");
  await expect(page.getByText("Entree 02", { exact: true })).toBeVisible();
  await expect(page.getByText("Sandbox Tacos", { exact: true })).toHaveCount(0);
});

test("menu history lists newest menus first and deletes only from detail after confirmation", async ({
  page
}) => {
  await page.goto("/planner");
  await page.getByLabel("Meals").fill("1");
  await page.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: "Save menu" }).click();
  await expect(page.getByRole("button", { name: "Aggregate ingredients" })).toBeVisible();
  await page.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: "Save menu" }).click();
  await expect(page.getByRole("button", { name: "Aggregate ingredients" })).toBeVisible();

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("button", { name: "Menu History", exact: true }).click();
  await expect(page).toHaveURL(/\/menus$/);
  await expect(page.getByRole("heading", { name: "Menu History", level: 3 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete menu" })).toHaveCount(0);

  const firstMenu = page.locator(".menu-history-table tbody tr").first();
  await expect(firstMenu).toContainText("1");
  const menuName = await firstMenu.getByRole("button").textContent();
  await firstMenu.locator("td").first().click();
  await expect(page).toHaveURL(/\/menus\/\d+$/);
  await expect(page.getByRole("heading", { name: menuName ?? "", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meal 1", level: 4 })).toBeVisible();
  await expect(page.getByText("Entrée", { exact: true })).toBeVisible();

  const cancelDialogPromise = page.waitForEvent("dialog");
  await page.getByRole("button", { name: "Delete menu" }).click();
  const cancelDialog = await cancelDialogPromise;
  expect(cancelDialog.type()).toBe("confirm");
  expect(cancelDialog.message()).toContain("This action cannot be undone.");
  await cancelDialog.dismiss();
  await expect(page).toHaveURL(/\/menus\/\d+$/);

  const confirmDialogPromise = page.waitForEvent("dialog");
  await page.getByRole("button", { name: "Delete menu" }).click();
  const confirmDialog = await confirmDialogPromise;
  await confirmDialog.accept();
  await expect(page).toHaveURL(/\/menus$/);

  const remainingMenus = page.locator(".menu-history-link");
  await expect(remainingMenus).toHaveCount(1);
  await remainingMenus.click();
  await expect(page.getByRole("button", { name: "Delete menu" })).toBeEnabled();
});
