# Feature ideas and bugs

Use this document as a lightweight backlog for possible features and bugs found while using Grocery Getter. Keep enough detail in each entry to understand and reproduce it later.

Suggested statuses: `Idea`, `Open`, `In progress`, `Blocked`, and `Done`.

## Feature ideas

### Add edit shortcuts to planner recipe and custom-list selectors

- Status: `Done`
- Reported: 2026-07-20
- Area: Planner
- Description: Add an edit button beside each recipe dropdown during menu generation and beside each custom shopping list in the planner.
- Expected: For a recipe dropdown, the button opens the edit page for the recipe currently selected in that dropdown. For a custom shopping list, the button opens that list for editing.
- Notes: The recipe edit action should follow the current dropdown selection so the user can quickly inspect or update any recipe while building a menu.

### Fall back to search results when a preferred QFC item is unavailable

- Status: `Idea`
- Reported: 2026-07-20
- Area: QFC store-item review
- Description: When a preferred ingredient product is unavailable, use the next appropriate products from the ingredient's normal search results instead of leaving the unavailable preferred product as the effective recommendation.
- Expected: The review stage presents an available search result as the fallback and includes a short, unobtrusive explanation that search results are being shown because the preferred item is out of stock.
- Notes: Preserve the user's preferred-item association; falling back for the current review should not silently replace or remove that preference.

### Allow setting quantity during store-item review

- Status: `Done`
- Reported: 2026-07-14
- Area: Store-item review
- Description: Allow the user to set or adjust the quantity of an item while reviewing its store-item match.
- Expected: The selected quantity is used when the approved item is added to the store cart.
- Notes: Quantity defaults to one cart unit and can be changed to any positive whole number during review. The selected quantity is kept with the transient review and sent to the cart API.

### Show prices and availability in the store-item review dropdown

- Status: `Idea`
- Reported: 2026-07-14; expanded 2026-07-20
- Area: QFC store-item review
- Description: Display the price and stock status of each store item alongside its name in the product-selection dropdown.
- Expected: The user can compare prices and see whether an item is out of stock before selecting and approving a store-item match. Out-of-stock items remain selectable but are clearly labeled.
- Notes: Account for products with unavailable prices or multiple price types, such as regular, promotional, or loyalty pricing. Use a concise label such as `Out of stock` for unavailable products.

## Bugs

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
