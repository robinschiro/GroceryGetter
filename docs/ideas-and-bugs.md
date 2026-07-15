# Feature ideas and bugs

Use this document as a lightweight backlog for possible features and bugs found while using Grocery Getter. Keep enough detail in each entry to understand and reproduce it later.

Suggested statuses: `Idea`, `Open`, `In progress`, `Blocked`, and `Done`.

## Feature ideas

### Allow setting quantity during store-item review

- Status: `Idea`
- Reported: 2026-07-14
- Area: Store-item review
- Description: Allow the user to set or adjust the quantity of an item while reviewing its store-item match.
- Expected: The selected quantity is used when the approved item is added to the store cart.
- Notes: Consider whether quantity should default from the aggregated shopping-list amount or the store item's package size.

### Show prices in the store-item review dropdown

- Status: `Idea`
- Reported: 2026-07-14
- Area: Store-item review
- Description: Display the price of each store item alongside its name in the product-selection dropdown.
- Expected: The user can compare prices before selecting and approving a store-item match.
- Notes: Account for products with unavailable prices or multiple price types, such as regular, promotional, or loyalty pricing.

## Bugs

### Ingredient aggregation does not combine some matching ingredients

- Status: `Open`
- Reported: 2026-07-14
- Area: Weekly menu shopping-list aggregation
- Example menu: **Mashed Eggplant Bhaji** (entree) with **Dal Rice** (starch side)
- Expected: The Roma tomato ingredients from both recipes are combined into one shopping-list item with an aggregated quantity.
- Actual: The Roma tomato ingredients are not combined in this case.
- Notes: Determine whether differences in ingredient name, unit, preparation, or stored metadata prevent the items from matching.

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
