# Dropbox Recipe Import Prompt

Use this prompt to convert plaintext recipe files into `parsed-recipes.json`.

You are extracting recipe data for a local grocery planning app. Convert the provided plaintext recipes into a JSON array only. Do not include prose, markdown fences, comments, or trailing commas.

Each recipe object must match this shape:

```json
{
  "name": "Recipe name",
  "category": "entree",
  "servings": 4,
  "notes": "Optional preparation notes or empty string.",
  "sourcePath": "raw/example.txt",
  "syncStatus": "llm_import",
  "ingredients": [
    {
      "text": "1 cup chopped onion",
      "quantity": "1",
      "unit": "cup",
      "item": "onion"
    }
  ]
}
```

Rules:
- `category` must be one of `entree`, `vegetable_side`, or `starch_side`. Infer it from the recipe when clear. Use `entree` when uncertain.
- `servings` must be a number or `null`. If the recipe says "serves 4-6", use the lower number and mention the original range in `notes`.
- Preserve every ingredient line in `text` exactly enough that a human can recognize the source ingredient.
- Split ingredient lines into `quantity`, `unit`, and `item` only when reasonably clear.
- Leave `quantity` or `unit` as an empty string when unclear.
- `item` must contain the grocery-store search term, not the full prepared ingredient phrase. It must not be empty.
- Titles, recipe names, section labels, and serving lines are never ingredients. Exclude lines such as `Chicken Casserole`, `Chili`, `4 people`, `Step:`, `Marinade:`, `Velveting the beef`, `Dry rub for 3 racks of ribs`, and `Tenderizing the chicken thighs:`.
- Equipment, containers, and cookware are never ingredients. Exclude lines such as `9 x 5 baking pan`, `9" circular pie pan`, `container`, `pot`, `pan`, `skillet`, `foil`, or similar kitchen tools.
- Storage, scaling, technique, and reminder lines are never ingredients. Exclude lines such as `DOUBLE FOR 4`, `Store 500g of chili in each container`, `Check at 1.5 hours`, `TODO`, `DISCLAIMER`, and `Read all the steps first`.
- Ingredient extraction must stop when a line becomes a preparation step, even if later lines mention food. Do not resume extracting from the instructions unless a new explicit ingredient subsection appears.
- Do not include instruction shorthand as ingredients. Exclude lines like `Mayo -> Mustard -> Curry -> Soup -> Milk -> Cheddar`, `Onions and peppers in pan on medium`, `In magic bullet, grind up the tomatoes`, and `As soon as garlic starts to brown, put shrimp in`.
- If a line mixes an ingredient with an instruction, keep only the ingredient if it can be represented cleanly. For example, `3 room temp eggs - put in warm water for 5 minutes` becomes `{"text":"3 room temp eggs","quantity":"3","unit":"","item":"eggs"}`. If the ingredient cannot be cleanly separated, leave the line out and put the information in `notes`.
- Strip preparation actions and cut styles from `item`, including words like "chopped", "minced", "diced", "sliced", "grated", "crushed", "peeled", "thinly", "finely", "roughly", "freshly", "beaten", "melted", "softened", "divided", "drained", "washed", "stem removed", "cut into", and similar prep-only language.
- Strip usage notes and taste modifiers from `item`, including phrases like "to taste", "optional", "for garnish", "as needed", "or more", "if desired", "for serving", "plus more", parenthetical cooking notes, brand commentary, and storage notes.
- Keep grocery-relevant descriptors in `item` when they affect what to buy, such as "boneless skinless chicken thighs", "frozen vegetables", "canned corn", "evaporated milk", "sweetened condensed milk", "extra firm tofu", "wide egg noodles", "Italian sausage", "brown sugar", "red wine vinegar", or "low sodium soy sauce".
- Remove packaging/count words from `item` when they are not grocery search terms. For example, `30 oz. package frozen vegetables` should have `item: "frozen vegetables"`, `16 oz. package of hearty egg noodles` should have `item: "hearty egg noodles"`, and `1 batch broccoli rabe` should have `item: "broccoli rabe"`.
- Normalize ingredient items like this:
  - Source `2 tbsp chopped parsley` becomes `{"text":"2 tbsp chopped parsley","quantity":"2","unit":"tbsp","item":"parsley"}`.
  - Source `Salt to taste` becomes `{"text":"Salt to taste","quantity":"","unit":"","item":"salt"}`.
  - Source `1/2 large onion, chopped` becomes `{"text":"1/2 large onion, chopped","quantity":"1/2","unit":"","item":"onion"}`.
  - Source `3 cloves garlic, minced` becomes `{"text":"3 cloves garlic, minced","quantity":"3","unit":"cloves","item":"garlic"}`.
  - Source `1 cup freshly grated Parmesan cheese` becomes `{"text":"1 cup freshly grated Parmesan cheese","quantity":"1","unit":"cup","item":"Parmesan cheese"}`.
  - Source `For half a loaf of French Bread:` becomes `{"text":"half a loaf of French Bread","quantity":"1/2","unit":"loaf","item":"French bread"}`.
  - Source `1/2 cup oyster + 1/2 cup soy` becomes two rows: `{"text":"1/2 cup oyster sauce","quantity":"1/2","unit":"cup","item":"oyster sauce"}` and `{"text":"1/2 cup soy sauce","quantity":"1/2","unit":"cup","item":"soy sauce"}`.
- Move cooking instructions, timing, oven temperatures, and serving suggestions to `notes`; do not create ingredient rows for them.
- Ingredient extraction must stop when the recipe transitions into preparation content. Stop at headings such as `Steps`, `Instructions`, `Directions`, `Preparation`, `Method`, `Cooking`, `Process`, `Notes`, or similar section labels.
- Do not include lines that describe actions, even if they mention ingredients. Exclude lines starting with verbs such as `chop`, `dice`, `slice`, `add`, `put`, `throw`, `cook`, `boil`, `saute`, `stir`, `mix`, `drain`, `wash`, `rinse`, `preheat`, `serve`, `store`, `transfer`, `cover`, `reduce`, `simmer`, `taste`, `season`, `sprinkle`, `pour`, `heat`, `melt`, `blend`, `whisk`, `fry`, `grill`, `bake`, `broil`, `marinate`, `rub`, `coat`, `garnish`, or similar cooking actions.
- Do not include storage notes, serving notes, scaling notes, timing notes, shopping-location notes, reminders, TODOs, warnings, or troubleshooting notes as ingredients.
- If a recipe has no explicit `Ingredients` heading, only extract lines that are clearly shopping-list style. Do not extract narrative instructions.
- If uncertain whether a line is an ingredient or a step, leave it out of `ingredients` and preserve the information in `notes`.
- Do not invent ingredients or amounts.
- Do not scale quantities to a common serving count.
- Set `syncStatus` to `llm_import`.
- Include `sourcePath` for every recipe using the stable path under this import folder, for example `raw/example-pasta.txt`.
- Do not include `sourceHash`; the sync script computes it from the raw plaintext file.

Quality checks before final output:
- The final response is valid JSON.
- Every recipe has at least one ingredient.
- Every ingredient has non-empty `text` and `item`.
- No instruction-only lines are included as ingredients.
- No ingredient `text` starts with an action verb such as `add`, `chop`, `cook`, `mix`, `put`, `store`, or `serve`.
- No ingredient `text` is a title, section heading, serving count, equipment line, storage note, scaling note, timing note, or cooking technique note.
- No ingredient `item` is a vague fragment such as `Then`, `At the end`, `In magic bullet`, `people`, `package frozen vegetables`, `x 5 baking pan`, or `For every one cup of semolina`.
