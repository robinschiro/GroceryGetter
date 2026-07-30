import { expect, test } from "playwright/test";
import { resetDatabase } from "../../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

async function saveAndAggregateMenu(page: import("playwright/test").Page) {
  await page.goto("/planner");
  await page.getByLabel("Meals").fill("1");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("Meal 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Entree", { exact: true })).not.toHaveValue("");
  await page.getByRole("button", { name: "Save menu" }).click();
  await expect(page.getByRole("button", { name: "Aggregate ingredients" })).toBeVisible();
  await page.getByRole("button", { name: "Aggregate ingredients" }).click();
  await expect(page.getByRole("button", { name: "Review store items" })).toBeVisible();
}

test("planner and aggregated-list journeys preserve menu editing, persistence, provenance, source saves, approval, clearing, and regeneration", async ({
  page
}) => {
  await page.goto("/planner");
  await page.getByLabel("Meals").fill("2");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("Meal 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Meal 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Entree", { exact: true }).first()).not.toHaveValue("");
  await page.getByLabel("Vegetable side", { exact: true }).first().selectOption("");

  await page.getByRole("button", { name: "Add meal" }).click();
  await expect(page.getByText("3 of 14 meals")).toBeVisible();
  await page.getByRole("button", { name: "Remove meal 2" }).click();
  await expect(page.getByText("2 of 14 meals")).toBeVisible();
  const weeklyList = page.getByRole("checkbox", { name: /^Weekly Staples \(\d+\)$/ });
  await expect(weeklyList).toBeChecked();
  await weeklyList.uncheck();
  await weeklyList.check();

  await page.getByRole("button", { name: "Save menu" }).click();
  await expect(page.getByRole("button", { name: "Aggregate ingredients" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Aggregate ingredients" })).toBeVisible();
  await expect(page.getByText("2 of 14 meals")).toBeVisible();

  const entree = page.getByLabel("Entree", { exact: true }).first();
  const entreeOptions = await entree.locator("option").all();
  if (entreeOptions.length > 1) {
    await entree.selectOption({ index: 1 });
  }
  await page.getByRole("button", { name: "Aggregate ingredients" }).click();
  await expect(page.getByRole("button", { name: "Cross off tomato" })).toBeVisible();
  await expect(page.getByText("Weekly Staples", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Cross off tomato" }).click();
  await expect(page.getByRole("button", { name: /unchecked ingredient/ })).toBeVisible();
  await page.getByRole("button", { name: /unchecked ingredient/ }).click();
  await page.getByRole("button", { name: "Restore tomato" }).click();
  await expect(page.getByRole("button", { name: "Cross off tomato" })).toBeVisible();

  const editable = page.getByRole("button", { name: /^Edit item name for / }).first();
  const editableName = await editable.getAttribute("aria-label");
  await editable.click();
  const sourceName = editableName?.replace("Edit item name for ", "") ?? "";
  const editor = page.getByRole("textbox", { name: `Item name for ${sourceName}`, exact: true });
  await editor.fill("browser characterized item");
  await page.getByRole("button", { name: `Save item name to ${sourceName}` }).click();
  await expect(page.getByText(/Saved item details to/)).toBeVisible();

  await page.getByRole("button", { name: "Clear aggregated ingredients" }).click();
  await expect(page.getByText("Aggregate a menu to review its grocery list.")).toBeVisible();
  await page.getByRole("button", { name: "Aggregate ingredients" }).click();
  await expect(page.getByRole("button", { name: "Review store items" })).toBeVisible();
});

test("fake-QFC review preserves matching, unmatched recovery, candidates, memory, quantity, removal/restoration, polling, and fake submission", async ({
  page
}) => {
  await saveAndAggregateMenu(page);
  await page.getByRole("button", { name: "Review store items" }).click();
  await expect(page.getByRole("heading", { name: "Unmatched ingredients" })).toBeVisible();
  await expect(page.getByText("unmatched item", { exact: true }).first()).toBeVisible();

  const firstCandidate = page.getByLabel(/^Store item for /).first();
  await expect(firstCandidate.locator("option").nth(0)).toHaveText(
    /Kroger .* · \$2\.49 · In stock/
  );
  await expect(firstCandidate.locator("option").nth(1)).toHaveText(
    /Test Kitchen .* · \$3\.49 promo \(reg\. \$3\.99\) · Low stock/
  );
  await expect(firstCandidate.locator("option").nth(2)).toHaveText(
    /Pantry Select .* · Price unavailable · Out of stock/
  );
  await expect(firstCandidate.locator("option").nth(2)).toBeEnabled();
  await firstCandidate.selectOption({ index: 1 });
  await expect(page.getByText("Remembered store item", { exact: true }).first()).toBeVisible();
  const quantity = page.getByLabel(/^Cart quantity for /).first();
  await quantity.fill("3");
  await expect(quantity).toHaveValue("3");

  const unmatchedRow = page.locator(".store-item-unmatched-row").filter({ hasText: "unmatched item" });
  await unmatchedRow.getByRole("button", { name: "Find item" }).click();
  await unmatchedRow.getByPlaceholder("Enter a different search term").fill("recovered item");
  await unmatchedRow.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/ingredient is now matched/)).toBeVisible();

  const reviewRemove = page.getByRole("button", { name: /^Remove .* from review$/ }).first();
  const removedLabel = await reviewRemove.getAttribute("aria-label");
  await reviewRemove.click();
  await expect(page.getByRole("status").filter({ hasText: "Removed" })).toBeVisible();
  await expect(page.getByRole("button", { name: removedLabel ?? "" })).toHaveCount(0);

  await page.getByRole("button", { name: "Cross off tomato" }).click();
  await page.getByRole("button", { name: /unchecked ingredient/ }).click();
  await page.getByRole("button", { name: "Restore tomato" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Added tomato back/ })).toBeVisible();

  const submit = page.getByRole("button", { name: /Add \d+ reviewed store items? to QFC/ });
  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: /added to the QFC cart/ })).toBeVisible();
});

test("QFC settings preserve scoped preferences, production-only credentials, fake searches, and sandbox cart safeguards", async ({
  page
}) => {
  await page.goto("/settings/qfc/api");
  await expect(page.getByLabel("Client ID")).toHaveValue("fake-client-id");
  await page.getByPlaceholder("Search locations by ZIP").fill("98101");
  await page.getByRole("button", { name: "Find locations" }).click();
  await expect(page.getByText("QFC Test Market", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search store items").fill("tomato");
  await page.getByRole("button", { name: "Find store items" }).click();
  await expect(page.getByText("Kroger tomato", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Store Item Preferences" }).click();
  const storeBrands = page.getByLabel(/Prefer store brands/);
  await expect(storeBrands).toBeChecked();
  await storeBrands.uncheck();

  await page.getByLabel("Data mode").selectOption("sandbox");
  await page.getByRole("tab", { name: "QFC API Setup" }).click();
  await expect(page.getByText(/Credentials and OAuth can only be changed in production/)).toBeVisible();
  await expect(page.getByLabel("Client ID")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start customer OAuth" })).toBeDisabled();
  await page.getByRole("tab", { name: "Store Item Preferences" }).click();
  await expect(page.getByLabel(/Allow this sandbox mode/)).not.toBeChecked();
});
