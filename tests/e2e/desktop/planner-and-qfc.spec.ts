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

test("OurGroceries default, per-menu selection, and external provenance links work end to end", async ({ page }) => {
  await page.goto("/settings/ourgroceries");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const remoteLists = page.getByLabel("OurGroceries shopping lists");
  await expect(remoteLists).toHaveCSS("max-height", "none");
  await expect(remoteLists).toHaveCSS("overflow", "visible");
  await page.getByLabel("OurGroceries email").fill("browser-test@example.com");
  await page.getByLabel("OurGroceries password").fill("not-returned-secret");
  await page.getByRole("button", { name: "Update credentials" }).click();
  await expect(page.getByText("br**********@example.com", { exact: true })).toBeVisible();
  await expect(page.getByLabel("OurGroceries password")).toHaveValue("");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  const firstRemoteList = page.locator(".ourgroceries-list-row").first();
  await expect(firstRemoteList).toHaveCSS("color", "rgb(238, 244, 240)");
  await expect(firstRemoteList).toHaveCSS("background-color", "rgb(29, 38, 33)");
  const defaultList = page.getByLabel("Default OurGroceries list");
  await defaultList.selectOption({ label: "Costco" });
  await expect(defaultList).toHaveValue("fake-ourgroceries-costco");

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("button", { name: "Planner", exact: true }).click();
  await page.getByLabel("Meals").fill("1");
  await page.getByRole("button", { name: "Generate" }).click();
  const menuList = page.getByRole("combobox", { name: "List", exact: true });
  await expect(menuList).toHaveValue("fake-ourgroceries-costco");

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("button", { name: "OurGroceries", exact: true }).click();
  await defaultList.selectOption({ label: "OurGroceries Weekly" });
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("button", { name: "Planner", exact: true }).click();
  await expect(menuList).toHaveValue("fake-ourgroceries-costco");

  await page.getByRole("button", { name: "Save menu" }).click();
  await page.getByRole("button", { name: "Aggregate ingredients" }).click();
  const remoteLinks = page.getByRole("link", { name: "Open Costco in OurGroceries" });
  await expect(remoteLinks.first()).toHaveAttribute("href", /ourgroceries\.com\/your-lists/);
  await expect(remoteLinks.first()).toHaveAttribute("target", "_blank");
  await expect(remoteLinks.first()).toHaveAttribute("rel", "noopener noreferrer");

  await page.getByRole("button", { name: "Review store items" }).click();
  await expect(page.getByRole("link", { name: "Open Costco in OurGroceries" }).first()).toBeVisible();
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

  const declineDialogPromise = page.waitForEvent("dialog");
  const reviewOnlySelection = firstCandidate.selectOption({ index: 0 });
  const declineDialog = await declineDialogPromise;
  expect(declineDialog.type()).toBe("confirm");
  expect(declineDialog.message()).toMatch(/is remembered for .*Make .* the new preference/);
  await declineDialog.dismiss();
  await reviewOnlySelection;
  await expect(page.getByText("Selected for this review", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Kept .* as the remembered preference/ }))
    .toBeVisible();

  const confirmDialogPromise = page.waitForEvent("dialog");
  const rememberedSelection = firstCandidate.selectOption({ index: 2 });
  const confirmDialog = await confirmDialogPromise;
  expect(confirmDialog.type()).toBe("confirm");
  await confirmDialog.accept();
  await rememberedSelection;
  await expect(page.getByText("Remembered store item", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Remembered Pantry Select/ })).toBeVisible();

  const quantity = page.getByLabel(/^Cart quantity for /).first();
  await quantity.fill("3");
  await expect(quantity).toHaveValue("3");

  const tomatoRow = page.locator(".store-item-match-row").filter({
    has: page.getByText("tomato", { exact: true })
  });
  await tomatoRow.getByRole("button", { name: "Show quantity sources for tomato" }).click();
  const quantitySources = tomatoRow.getByRole("region", { name: "Quantity sources for tomato" });
  await expect(quantitySources).toBeVisible();
  await expect(quantitySources).toContainText("Weekly Staples");
  await expect(quantitySources).toContainText("1");
  await tomatoRow.getByRole("button", { name: "Hide quantity sources for tomato" }).click();
  await expect(quantitySources).toHaveCount(0);

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

test("fake-QFC review explains an available fallback without replacing the preferred item", async ({
  page
}) => {
  await saveAndAggregateMenu(page);
  await page.getByRole("button", { name: "Review store items" }).click();

  const unavailableItem = page.getByLabel("Store item for preferred unavailable item", {
    exact: true
  });
  await unavailableItem.selectOption({ index: 0 });
  await expect(unavailableItem.locator("option:checked")).toContainText(
    "Kroger preferred unavailable item"
  );

  await page.getByRole("button", { name: "Review store items" }).click();
  const fallbackRow = page.locator(".store-item-match-row").filter({
    has: page.getByLabel("Store item for preferred unavailable item", { exact: true })
  });
  await expect(fallbackRow.getByText("Available search result", { exact: true })).toBeVisible();
  await expect(fallbackRow.getByText(
    "Your preferred item is out of stock, so an available search result is selected for this review."
  )).toBeVisible();
  await expect(
    fallbackRow.getByLabel("Store item for preferred unavailable item", {
      exact: true
    }).locator("option:checked")
  ).toContainText("Test Kitchen preferred unavailable item");

  await page.goto("/ingredients");
  const rememberedPreference = page.locator(".ingredient-preference-row").filter({
    hasText: "preferred unavailable item"
  });
  await expect(rememberedPreference).toContainText("Kroger preferred unavailable item");
});

test("Ingredients manages pantry status with search, filters, persistence, and scope isolation", async ({
  page
}) => {
  await page.goto("/ingredients");
  const tomato = page.locator(".ingredient-preference-row").filter({
    has: page.getByText("tomato", { exact: true })
  });
  const tomatoSources = tomato.getByRole("button", {
    name: "Used in 2 recipes and 1 shopping list",
    exact: true
  });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(tomatoSources).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(tomatoSources).toHaveCSS("color", "rgb(185, 200, 193)");
  await tomatoSources.click();
  await expect(page.getByRole("link", { name: "Weeknight Pasta", exact: true }))
    .toHaveAttribute("href", /\/recipes\/manage\/\d+$/);
  await expect(page.getByRole("link", { name: "Roasted Broccoli", exact: true }))
    .toHaveAttribute("href", /\/recipes\/manage\/\d+$/);
  await expect(page.getByRole("link", { name: "Weekly Staples", exact: true }))
    .toHaveAttribute("href", /\/shopping-lists\/manage\/\d+$/);
  const oliveOil = page.locator(".ingredient-preference-row").filter({
    has: page.getByText("olive oil", { exact: true })
  });
  await expect(oliveOil).toContainText("Used in 1 recipe");
  await expect(oliveOil.getByRole("checkbox")).not.toBeChecked();
  await oliveOil.getByRole("checkbox").check();
  await expect(oliveOil.getByText("Assumed on hand unless active in OurGroceries.")).toBeVisible();

  await page.getByLabel("Ingredient filter").selectOption("pantry");
  await expect(page.locator(".ingredient-preference-row")).toHaveCount(1);
  await expect(page.getByText("olive oil", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Ingredient filter")).toHaveValue("all");
  await expect(page.locator(".ingredient-preference-row").filter({
    has: page.getByText("olive oil", { exact: true })
  }).getByRole("checkbox")).toBeChecked();

  await page.getByLabel("Data mode").selectOption("sandbox");
  await expect(page.getByText("olive oil", { exact: true })).toHaveCount(0);
  await expect(page.getByText("unmatched shells", { exact: true })).toBeVisible();
  await page.getByLabel("Ingredient filter").selectOption("pantry");
  await expect(page.getByText("No ingredients match these filters.")).toBeVisible();
});

test("pantry ingredients explain automatic exclusion and can be restored for the current menu", async ({
  page,
  request
}) => {
  expect((await request.put("/api/ingredients/milk/pantry", {
    data: { ingredientName: "milk", isPantry: true }
  })).status()).toBe(200);
  const lists = await (await request.get("/api/ourgroceries/lists")).json() as Array<{ id: string }>;
  expect((await request.put("/api/ourgroceries/default-list", {
    data: { listId: lists[0].id }
  })).status()).toBe(200);

  await page.goto("/planner");
  await page.getByLabel("Meals").fill("1");
  await page.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: "Save menu" }).click();
  await page.getByRole("button", { name: "Aggregate ingredients" }).click();
  await page.getByRole("button", { name: /unchecked ingredient/ }).click();
  const milk = page.getByRole("button", { name: "Restore milk" });
  await expect(milk).toContainText("Automatically unchecked — pantry ingredient");
  await milk.click();
  await expect(page.getByText("Automatically unchecked — pantry ingredient")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cross off milk" })).toBeVisible();
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
