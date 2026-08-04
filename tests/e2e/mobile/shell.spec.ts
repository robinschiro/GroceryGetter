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

  await page.getByLabel("Data mode").selectOption("sandbox");
  await expect(page.getByRole("status").filter({ hasText: "Sandbox mode" })).toBeVisible();
});
