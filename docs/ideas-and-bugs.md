# Feature ideas and bugs

Use this document as a lightweight backlog for possible features and bugs found while using Grocery Getter. Keep enough detail in each entry to understand and reproduce it later.

Suggested statuses: `Idea`, `Open`, `In progress`, `Blocked`, and `Done`.

## Feature ideas

### Show ingredient-review updates in a temporary toast

- Status: `Done`
- Reported: 2026-09-04
- Area: Planner ingredient review
- Description: Make status updates visible when actions occur outside the user's current viewport, such as when a pantry ingredient remains included because it is active in the selected OurGroceries list.
- Expected: Show transient planner outcomes in a prominent temporary toast that disappears after a short time and can be dismissed manually. Keep ongoing progress in its contextual progress UI instead of a toast.
- Notes: Planner status updates now use reusable queued toasts that dismiss automatically or immediately through their close buttons. Success and informational notices remain for five seconds, while errors remain for eight seconds. Persistent operation progress stays in its contextual progress UI.

### Organize store-item review by aisle

- Status: `Idea`
- Reported: 2026-09-03
- Area: QFC store-item review
- Description: Organize the items in Store Item Review according to the aisle where each selected store item is located.
- Expected: Review items are grouped and ordered by aisle so the user can review the list in store-shopping order. Items without aisle information are grouped separately rather than mixed into known aisles.

### Allow setting pantry status during ingredient review

- Status: `Done`
- Reported: 2026-08-25
- Area: Planner ingredient review
- Description: Allow the user to set an aggregated ingredient's pantry status before matching it to a store item.
- Expected: The user can mark or unmark an item as a pantry ingredient directly from the aggregated ingredient review.
- Notes: Pantry ingredients are automatically unchecked for the current menu and future aggregation. Unmarking restores items excluded automatically, while preserving manual cross-offs. Active OurGroceries items remain included.

### Add column headers to recipe ingredient fields

- Status: `Idea`
- Reported: 2026-08-06
- Area: Recipe create/edit
- Description: Add column headers above the ingredient fields on the recipe create and edit pages.
- Expected: Ingredient inputs are clearly labeled `Quantity`, `Unit`, `Name`, and `Notes` so users can quickly understand what belongs in each column.

### Add edit shortcuts to planner recipe and custom-list selectors

- Status: `Done`
- Reported: 2026-07-20
- Area: Planner
- Description: Add an edit button beside each recipe dropdown during menu generation and beside each custom shopping list in the planner.
- Expected: For a recipe dropdown, the button opens the edit page for the recipe currently selected in that dropdown. For a custom shopping list, the button opens that list for editing.
- Notes: The recipe edit action should follow the current dropdown selection so the user can quickly inspect or update any recipe while building a menu.

### Fall back to search results when a preferred QFC item is unavailable

- Status: `Done`
- Reported: 2026-07-20
- Area: QFC store-item review
- Description: When a preferred ingredient product is unavailable, use the next appropriate products from the ingredient's normal search results instead of leaving the unavailable preferred product as the effective recommendation.
- Expected: The review stage presents an available search result as the fallback and includes a short, unobtrusive explanation that search results are being shown because the preferred item is out of stock.
- Notes: The review now detects an out-of-stock remembered product, selects an available ranked search result for that review, and explains the fallback without replacing the saved preference.

### Allow setting quantity during store-item review

- Status: `Done`
- Reported: 2026-07-14
- Area: Store-item review
- Description: Allow the user to set or adjust the quantity of an item while reviewing its store-item match.
- Expected: The selected quantity is used when the approved item is added to the store cart.
- Notes: Quantity defaults to one cart unit and can be changed to any positive whole number during review. The selected quantity is kept with the transient review and sent to the cart API.

### Show prices and availability in the store-item review dropdown

- Status: `Done`
- Reported: 2026-07-14; expanded 2026-07-20
- Area: QFC store-item review
- Description: Display the price and stock status of each store item alongside its name in the product-selection dropdown.
- Expected: The user can compare prices and see whether an item is out of stock before selecting and approving a store-item match. Out-of-stock items remain selectable but are clearly labeled.
- Notes: Candidate labels now show regular or promotional pricing and a normalized availability label. Missing price or availability data is stated explicitly, and out-of-stock products remain selectable.

## Bugs

### Show ingredient save errors beside the affected ingredient

- Status: `Open`
- Reported: 2026-08-25
- Area: Planner ingredient review
- Expected: If a change to an ingredient cannot be saved, the error is displayed immediately below that ingredient.
- Actual: The save error is displayed at the bottom of the ingredient review section, away from the ingredient that caused it.

### Ingredient aggregation does not combine some matching ingredients

- Status: `Done`
- Reported: 2026-07-14
- Area: Weekly menu shopping-list aggregation
- Example menu: **Mashed Eggplant Bhaji** (entree) with **Dal Rice** (starch side)
- Expected: The Roma tomato ingredients from both recipes are combined into one shopping-list item with an aggregated quantity.
- Actual: The Roma tomato ingredients are not combined in this case.
- Notes: Fixed by grouping ingredients by normalized item and unit even when the unit is blank. Previously, unitless ingredients fell back to their full text, so quantities such as `1 roma tomato` and `2 roma tomato` produced different grouping keys.

## Entry template

### Short title

- Type: `Feature` or `Bug`
- Status: `Idea` or `Open`
- Reported: YYYY-MM-DD
- Area:
- Description:
- Expected:
- Actual:
- Reproduction steps or example:
- Notes:
