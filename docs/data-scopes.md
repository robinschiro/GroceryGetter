# Production and sandbox data

Grocery Getter stores production and sandbox records in the same SQLite database while enforcing a scope on every API request.

## Website modes

Use the **Data** selector in the website header to switch modes:

- **Production** loads production recipes, reusable shopping lists, menus, generated shopping lists, settings, and remembered store items.
- **Sandbox** loads an isolated set of those records and displays an amber warning.

The selection is saved in browser local storage. The frontend sends it on every request through the `X-Data-Scope` header. Requests without the header default to production.

Changing modes clears the loaded planner and QFC review state before the selected scope is loaded.

## QFC behavior

Both modes use the real Kroger/QFC location and product APIs when credentials are configured.

Developer credentials and customer OAuth tokens are shared integration settings. They are visible but read-only in sandbox. The selected location, store-brand preference, remembered store items, and cart-mutation permission are scoped.

Real cart changes are enabled by default in production and disabled by default in sandbox. They can be enabled for the current mode under **QFC Settings → Store Item Preferences**. The API checks this permission immediately before calling the cart API.

## Recipe imports

Recipe imports use production unless another scope is explicit:

```powershell
npm run import:recipes -- --scope=sandbox
```

`--scope` accepts `production` or `sandbox`. Sync planning only compares recipes in the selected scope.

## Migration

Existing recipe and menu rows migrate according to their former `is_test_data` value. Existing reusable shopping lists and remembered store items migrate to production. Attachments between sandbox menus and production reusable lists are removed, and the affected generated shopping lists are cleared so they can be safely regenerated.
