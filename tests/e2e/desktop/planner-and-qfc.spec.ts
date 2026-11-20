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

test("submitted menu loads read only until Edit menu is selected", async ({ page, request }) => {
  await page.goto("/planner");
  await page.getByLabel("Meals").fill("2");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("Meal 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save menu" }).click();
  await expect(page.getByRole("button", { name: "Aggregate ingredients" })).toBeVisible();

  const saved = await (await request.get("/api/menus/latest")).json();
  await page.route(/\/api\/menus\/(?:latest|\d+)$/, async (route) => {
    const response = await route.fetch();
    const menu = await response.json();
    await route.fulfill({ response, json: { ...menu, status: "submitted" } });
  });
  await page.reload();

  const entree = page.getByLabel("Entree", { exact: true }).first();
  await expect(page.getByText("Read only")).toBeVisible();
  await expect(entree).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove meal 1" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add meal" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Aggregate ingredients" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /^Weekly Staples/ })).toBeDisabled();
  await expect((await (await request.get(`/api/menus/${saved.id}`)).json()).items).toEqual(saved.items);

  await page.getByRole("button", { name: "Edit menu" }).click();
  await expect(entree).toBeEnabled();
  const original = await entree.inputValue();
  const alternative = await entree.locator("option").evaluateAll((options, selected) =>
    options.map((option) => (option as HTMLOptionElement).value).find((value) => value !== selected),
    original
  );
  if (!alternative) throw new Error("The test needs a second entree recipe.");
  await entree.selectOption(alternative);
  await expect(entree).toHaveValue(alternative);
  await expect(entree).toBeEnabled();

  await page.getByRole("button", { name: "Done editing" }).click();
  await expect(entree).toBeDisabled();
  await page.reload();
  await expect(entree).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit menu" })).toBeVisible();
  const updated = await (await request.get(`/api/menus/${saved.id}`)).json();
  expect(updated.items.find((item: { mealNumber: number; slot: string }) =>
    item.mealNumber === 1 && item.slot === "entree").recipeId).toBe(Number(alternative));

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("button", { name: "Save menu" })).toBeVisible();
  await expect(page.getByLabel("Entree", { exact: true }).first()).toBeEnabled();
});

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
  const broccoliRow = page.getByRole("button", { name: "Cross off broccoli" });
  const broccoliSources = broccoliRow.locator(".shopping-source-summary");
  await expect(broccoliSources).toContainText("For");
  await expect(broccoliSources.getByRole("link", { name: "Roasted Broccoli" })).toBeVisible();
  await expect(broccoliSources.getByRole("button", { name: "multiple", exact: true })).toHaveCount(0);

  const tomatoRow = page.getByRole("button", { name: "Cross off tomato" });
  const multipleSources = tomatoRow.getByRole("button", { name: "multiple", exact: true });
  await expect(multipleSources).toBeVisible();
  await expect(tomatoRow.getByRole("link", { name: "Weekly Staples", exact: true })).toHaveCount(0);
  await multipleSources.click();
  await expect(tomatoRow.locator(".shopping-source-list li")).toHaveCount(2);
  await expect(tomatoRow.getByRole("link", { name: "Roasted Broccoli", exact: true })).toBeVisible();
  await expect(tomatoRow.getByRole("link", { name: "Weekly Staples", exact: true })).toBeVisible();

  await tomatoRow.click();
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
  const aisleHeadings = page.locator(".store-item-aisle-group > h4");
  await expect(aisleHeadings).toContainText([
    "Aisle 2 · Dairy",
    "Aisle 5 · Pantry",
    "Aisle 10 · Produce",
    "Aisle unavailable"
  ]);
  await expect(page.getByRole("heading", { name: "Unmatched ingredients" })).toBeVisible();
  await expect(page.getByText("unmatched item", { exact: true }).first()).toBeVisible();

  const firstCandidate = page.getByLabel("Store item for tomato", { exact: true });
  const tomatoRow = page.locator(".store-item-match-row").filter({ has: firstCandidate });
  await expect(page.locator(".store-item-aisle-group", { has: firstCandidate }))
    .toContainText("Aisle 10 · Produce");
  await expect(firstCandidate.locator("option").nth(0)).toHaveText(
    /Kroger .* · \$2\.49 · In stock/
  );
  await expect(firstCandidate.locator("option").nth(1)).toHaveText(
    /Test Kitchen .* · \$3\.49\/lb promo \(reg\. \$3\.99\/lb\) · Low stock/
  );
  await expect(firstCandidate.locator("option").nth(2)).toHaveText(
    /Pantry Select .* · Price unavailable · Out of stock/
  );
  await expect(firstCandidate.locator("option").nth(2)).toBeEnabled();
  await expect(tomatoRow.locator(".store-item-unit-label")).toHaveText("ct");
  await expect(tomatoRow).toContainText("Package size: 12 oz");
  await firstCandidate.selectOption({ index: 1 });
  await expect(tomatoRow.locator(".store-item-unit-check summary")).toHaveText("Set unit");
  await expect(tomatoRow.locator(".store-item-unit-editor")).toBeHidden();
  await expect(tomatoRow).toContainText("Pricing size: 1 lb");
  await expect(page.getByText("Remembered store item", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".store-item-aisle-group", { has: firstCandidate }))
    .toContainText("Aisle 5 · Pantry");

  const declineDialogPromise = page.waitForEvent("dialog");
  const reviewOnlySelection = firstCandidate.selectOption({ index: 0 });
  const declineDialog = await declineDialogPromise;
  expect(declineDialog.type()).toBe("confirm");
  expect(declineDialog.message()).toMatch(/is remembered for .*Make .* the new preference/);
  await declineDialog.dismiss();
  await reviewOnlySelection;
  await expect(page.getByText("Selected for this review", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".toast").filter({ hasText: /Kept .* as the remembered preference/ }))
    .toBeVisible();

  const savePreferenceDialogPromise = page.waitForEvent("dialog");
  const savePreference = tomatoRow.getByRole("button", {
    name: /^Remember selected store item for /
  }).click();
  const savePreferenceDialog = await savePreferenceDialogPromise;
  expect(savePreferenceDialog.type()).toBe("confirm");
  await savePreferenceDialog.accept();
  await savePreference;
  await expect(page.locator(".toast").filter({ hasText: "Preference saved." })).toBeVisible();

  const confirmDialogPromise = page.waitForEvent("dialog");
  const rememberedSelection = firstCandidate.selectOption({ index: 2 });
  const confirmDialog = await confirmDialogPromise;
  expect(confirmDialog.type()).toBe("confirm");
  await confirmDialog.accept();
  await rememberedSelection;
  await expect(page.getByText("Remembered store item", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".toast").filter({ hasText: /^Remembered Pantry Select/ })).toBeVisible();
  await expect(page.locator(".store-item-aisle-group", { has: firstCandidate }))
    .toContainText("Aisle unavailable");

  const quantity = page.getByLabel(/^Cart quantity for /).first();
  await quantity.fill("3");
  await expect(quantity).toHaveValue("3");

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
  await expect(submit).toBeDisabled();
  for (const check of await page.locator(".store-item-unit-check").all()) {
    await check.locator("summary").click();
    await check.getByRole("combobox").selectOption("lb");
    await expect(check.locator("summary")).toHaveText("lb");
    await expect(check.locator(".store-item-unit-editor")).toBeHidden();
  }
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: /added to the QFC cart/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit menu" })).toBeVisible();
  await expect(page.getByLabel("Entree", { exact: true }).first()).toBeDisabled();
});

test("ordering units require an explicit QFC check and survive reload without changing quantities", async ({ page }) => {
  await saveAndAggregateMenu(page);
  await page.getByRole("button", { name: "Review store items" }).click();
  const select = page.getByLabel("Store item for tomato", { exact: true });
  const row = page.locator(".store-item-match-row").filter({ has: select });
  await select.selectOption({ index: 1 });
  const quantity = row.getByLabel(/^Cart quantity for /);
  await quantity.fill("5");
  const check = row.locator(".store-item-unit-check");
  await expect(check.locator("summary")).toHaveText("Set unit");
  await expect(check.getByRole("combobox")).toBeHidden();
  await check.locator("summary").click();
  await expect(check.getByRole("link", { name: "Check on QFC" })).toBeVisible();
  await expect(check.getByRole("combobox").locator("option")).toHaveText([
    "Choose unit", "Count (ct/each)", "Pounds (lb)", "Ounces (oz)", "Kilograms (kg)", "Grams (g)"
  ]);
  await check.getByRole("combobox").selectOption("each");
  await expect(check.locator("summary")).toHaveText("ct");
  await expect(check.getByRole("combobox")).toBeHidden();
  await expect(quantity).toHaveValue("5");
  await page.reload();
  await expect(check.locator("summary")).toHaveText("ct");
  await expect(check.getByRole("combobox")).toBeHidden();
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".cache/tests/ordering-unit-review.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await check.scrollIntoViewIfNeeded();
  for (const width of [1280, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const controls of await page.locator(".store-item-quantity-controls").all()) {
      const number = await controls.locator(".store-item-number-control").boundingBox();
      const info = await controls.locator(".store-item-quantity-info-button").boundingBox();
      expect(number).not.toBeNull();
      expect(info).not.toBeNull();
      expect(Math.abs(number!.y - info!.y)).toBeLessThan(1);
      expect(info!.x + info!.width).toBeLessThanOrEqual(width);
      const before = await controls.locator(".store-item-number-control button").evaluateAll((buttons) =>
        buttons.map((button) => ({ x: button.getBoundingClientRect().x, width: button.getBoundingClientRect().width })));
      await controls.locator(".store-item-quantity-info-button").click();
      const expanded = await controls.locator(".store-item-number-control button").evaluateAll((buttons) =>
        buttons.map((button) => ({ x: button.getBoundingClientRect().x, width: button.getBoundingClientRect().width })));
      expect(expanded).toEqual(before);
      await controls.locator(".store-item-quantity-info-button").click();
      const closed = await controls.locator(".store-item-number-control button").evaluateAll((buttons) =>
        buttons.map((button) => ({ x: button.getBoundingClientRect().x, width: button.getBoundingClientRect().width })));
      expect(closed).toEqual(before);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await row.getByRole("button", { name: "Show quantity sources for tomato" }).click();
  await expect(row.getByRole("region", { name: "Quantity sources for tomato" })).toBeVisible();
  await row.getByRole("button", { name: "Hide quantity sources for tomato" }).click();
  expect(await check.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth;
  })).toBe(true);
  await page.screenshot({ path: ".cache/tests/ordering-unit-review-mobile.png" });
  await check.locator("summary").click();
  expect(await check.locator(".store-item-unit-editor").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth;
  })).toBe(true);
  await page.screenshot({ path: ".cache/tests/ordering-unit-editor-mobile.png" });
  await check.locator("summary").click();
  page.on("dialog", (dialog) => void dialog.dismiss());
  await select.selectOption({ index: 2 });
  await expect(check.locator("summary")).toHaveText("Set unit");
  await expect(check.getByRole("combobox")).toBeHidden();
  await expect(quantity).toHaveValue("5");
  await select.selectOption({ index: 1 });
  await expect(check.locator("summary")).toHaveText("ct");
  await expect(check.locator("summary")).toHaveAttribute("title", /Previously verified on QFC/);
  await expect(quantity).toHaveValue("5");
  await page.getByRole("button", { name: "Review store items" }).click();
  await expect(check.locator("summary")).toHaveText("ct");
  await expect(check.getByRole("combobox")).toBeHidden();
});

test("fake-QFC review explains an available fallback without replacing the preferred item", async ({
  page
}) => {
  await saveAndAggregateMenu(page);
  await page.getByRole("button", { name: "Review store items" }).click();
  await expect(page.getByRole("heading", { name: "Aisle 5 · Pantry", exact: true })).toBeVisible();

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

test("QFC review selections survive a page reload", async ({ page }) => {
  await saveAndAggregateMenu(page);
  await page.getByRole("button", { name: "Review store items" }).click();
  await expect(page.locator(".store-item-match-row").first()).toBeVisible();

  const firstQuantity = page.getByLabel(/^Cart quantity for /).first();
  const quantityLabel = await firstQuantity.getAttribute("aria-label");
  await firstQuantity.fill("3");
  await expect(firstQuantity).toHaveValue("3");

  const removeButton = page.getByRole("button", { name: /^Remove .* from review$/ }).last();
  const removedLabel = await removeButton.getAttribute("aria-label");
  await removeButton.click();
  await expect(page.getByRole("button", { name: removedLabel ?? "" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Store Item Review" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: quantityLabel ?? "" })).toHaveValue("3");
  await expect(page.getByRole("button", { name: removedLabel ?? "" })).toHaveCount(0);
});

test("marking one ingredient as pantry preserves the other store item selections", async ({ page }) => {
  await saveAndAggregateMenu(page);
  await page.getByRole("button", { name: "Review store items" }).click();

  const tomato = page.getByLabel("Store item for tomato", { exact: true });
  await expect(tomato).toBeVisible();
  await tomato.selectOption({ index: 1 });
  await expect(tomato.locator("option:checked")).toContainText("Test Kitchen tomato");
  const selectedProduct = await tomato.inputValue();
  const tomatoQuantity = page.locator(".store-item-match-row")
    .filter({ has: tomato }).getByLabel(/^Cart quantity for /);
  await tomatoQuantity.fill("3");
  await expect(tomatoQuantity).toHaveValue("3");

  const milk = page.getByRole("button", { name: "Cross off milk" });
  await milk.getByRole("checkbox", { name: "Pantry status for milk" }).check();
  await expect(page.getByLabel("Store item for milk", { exact: true })).toHaveCount(0);
  await expect(tomato).toHaveValue(selectedProduct);
  await expect(tomatoQuantity).toHaveValue("3");
  await tomatoQuantity.fill("4");
  await expect(tomatoQuantity).toHaveValue("4");

  await page.reload();
  await expect(page.getByLabel("Store item for milk", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Store item for tomato", { exact: true }))
    .toHaveValue(selectedProduct);
  await expect(page.locator(".store-item-match-row")
    .filter({ has: page.getByLabel("Store item for tomato", { exact: true }) })
    .getByLabel(/^Cart quantity for /)).toHaveValue("4");

  await page.getByRole("button", { name: /unchecked ingredient/ }).click();
  await page.getByRole("checkbox", { name: "Pantry status for milk" }).uncheck();
  await expect(page.getByLabel("Store item for milk", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Store item for tomato", { exact: true }))
    .toHaveValue(selectedProduct);
  await page.reload();
  await expect(page.getByLabel("Store item for milk", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Store item for tomato", { exact: true }))
    .toHaveValue(selectedProduct);
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

test("aggregated ingredients manage pantry status and automatic exclusion", async ({ page }) => {
  await page.goto("/planner");
  await page.getByLabel("Meals").fill("1");
  await page.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("button", { name: "Save menu" }).click();
  await page.getByRole("button", { name: "Aggregate ingredients" }).click();
  const milk = page.locator(".shopping-row").filter({
    has: page.getByText("milk", { exact: true })
  });
  const pantry = milk.getByRole("checkbox", { name: "Pantry status for milk" });
  await expect(milk.locator(".shopping-item-editor .shopping-pantry-toggle")).toContainText("Pantry");
  await pantry.check();
  await expect(pantry).toBeChecked();
  await expect(milk.getByText("Assumed on hand; unchecked for this menu.", { exact: true })).toHaveCount(0);
  await expect(milk).toContainText("Automatically unchecked — pantry ingredient");
  const pantryMarkedMessage = "milk marked as pantry and moved to unchecked ingredients.";
  const pantryMarkedToast = page.getByRole("status").filter({ hasText: pantryMarkedMessage });
  await expect(pantryMarkedToast).toBeVisible();
  await pantryMarkedToast.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(pantryMarkedToast).toHaveCount(0);

  await pantry.uncheck();
  await expect(pantry).not.toBeChecked();
  await expect(page.getByText("Automatically unchecked — pantry ingredient")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cross off milk" })).toBeVisible();
  const pantryRemovedMessage = "milk removed from pantry and restored to this menu.";
  await expect(page.getByRole("status").filter({ hasText: pantryRemovedMessage })).toBeVisible();

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  const multipleSources = page.getByRole("button", { name: "multiple", exact: true }).first();
  await expect(multipleSources).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(multipleSources).toHaveCSS("color", "rgb(142, 209, 170)");
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
