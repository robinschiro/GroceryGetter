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
