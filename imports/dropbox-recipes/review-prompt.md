# Dropbox Recipe Import Review Prompt

Use this prompt after generating `parsed-recipes.json` from the raw Dropbox recipe files.

You are reviewing recipe extraction quality for a local grocery planning app. Compare the generated `parsed-recipes.json` against the corresponding plaintext recipes in `raw/`. Find semantic extraction errors that a JSON schema validator cannot catch.

Return a JSON array only. Do not include prose, markdown fences, comments, or trailing commas.

Each error object must match this shape:

```json
{
  "sourcePath": "raw/example.txt",
  "recipeName": "Recipe name",
  "ingredientText": "Problem ingredient text, or empty string if the recipe-level field is wrong",
  "field": "ingredients",
  "severity": "error",
  "problem": "Short description of what is wrong.",
  "suggestedAction": "remove",
  "suggestedReplacement": null
}
```

Allowed `field` values:
- `name`
- `category`
- `servings`
- `notes`
- `ingredients`
- `ingredient.item`
- `ingredient.quantity`
- `ingredient.unit`

Allowed `severity` values:
- `error`: must fix before import.
- `warning`: likely wrong, but needs human judgment.

Allowed `suggestedAction` values:
- `remove`
- `replace`
- `split`
- `move_to_notes`
- `human_review`

Review rules:
- Flag any ingredient row that is actually a title, recipe name, section heading, serving line, equipment line, cooking step, storage note, scaling note, timing note, technique note, TODO, warning, disclaimer, or reminder.
- Flag rows that start with action verbs such as `add`, `chop`, `cook`, `mix`, `put`, `store`, `serve`, `follow`, `verify`, `sear`, `spread`, `check`, `combine`, `boil`, `saute`, `heat`, `preheat`, `transfer`, `cover`, `remove`, or similar preparation actions.
- Flag rows that contain instruction-only phrases such as `preheat`, `oven`, `for 5 minutes`, `internal temperature`, `golden brown`, `take out`, `cutting board`, `in a bowl`, `in a pan`, `on stove`, `store 500g`, or `check at`.
- Flag equipment and container rows such as `9 x 5 baking pan`, `9" circular pie pan`, `container`, `foil`, `skillet`, `pot`, or `pan`.
- Flag headings and labels such as `Step:`, `Marinade:`, `Velveting the beef`, `Tenderizing the chicken thighs:`, `Dry rub for 3 racks of ribs`, or recipe titles included as ingredients.
- Flag malformed `item` values that are not grocery search terms, such as `Then`, `At the end`, `In magic bullet`, `people`, `x 5 baking pan`, `package frozen vegetables`, `package of hearty egg noodles`, `For every one cup of semolina`, or full instruction fragments.
- Flag ingredient lines that mix an ingredient with a preparation step. Suggest a replacement when the ingredient can be cleanly separated; otherwise suggest `move_to_notes`.
- Flag split-line ingredients that should be separate grocery rows, such as `1/2 cup oyster + 1/2 cup soy`.
- Flag missing required grocery rows when the raw recipe clearly lists an ingredient that is absent from `parsed-recipes.json`.
- Do not flag valid ingredient text merely because it contains `to taste`, `optional`, or `for garnish` if the `item` value is clean.
- Do not flag valid grocery descriptors such as `frozen vegetables`, `wide egg noodles`, `extra firm tofu`, `low sodium soy sauce`, `brown sugar`, or `red wine vinegar`.

Examples:
- `Chicken Casserole` in `ingredients` should be `remove` because it is the recipe title.
- `4 people` in `ingredients` should be `remove` and the serving count should be checked.
- `9 x 5 baking pan (use 9 x 13 if doubling)` should be `remove` because it is equipment.
- `Follow Mom/Dad's method for tenderizing the chicken thigh chunks` should be `move_to_notes`.
- `Then, sear the skin side of each thigh for 3 minutes...` should be `move_to_notes`.
- `3 room temp eggs - put in warm water for 5 minutes` should be `replace` with `3 room temp eggs`.
- `30 oz. package frozen vegetables` with `item: "package frozen vegetables"` should be `replace` with `item: "frozen vegetables"`.
- `1/2 cup oyster + 1/2 cup soy` should be `split` into oyster sauce and soy sauce rows.

Quality checks before final output:
- The final response is valid JSON.
- Every object has `sourcePath`, `recipeName`, `ingredientText`, `field`, `severity`, `problem`, `suggestedAction`, and `suggestedReplacement`.
- Use `suggestedReplacement: null` when no exact replacement is recommended.
- Prefer fewer high-confidence findings over a long list of speculative issues.
