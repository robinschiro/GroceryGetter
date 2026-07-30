# Grocery Getter architecture

## Runtime composition

`src/main.tsx` imports the ordered stylesheet entry point and mounts `src/app/App.tsx`. The app module owns only theme, data scope, navigation, route selection, shared recipe/list loading, and feature-page composition.

`server/index.ts` resolves configuration, creates and initializes the database, selects a production or fake Kroger client, constructs the Express app, listens, and handles shutdown. `server/app.ts` installs shared middleware and composes feature routers.

## Ownership

```text
shared/contracts/                         cross-process domain and response contracts
src/app/                                  browser shell
src/shared/                               scope-bound HTTP client, routes, shared UI metadata
src/features/recipes/                     recipe API, page state/UI, styles
src/features/shoppingLists/               reusable-list API, page state/UI, styles
src/features/planner/                     menu/generated-list API, orchestration, UI, styles
src/features/qfc/                         settings, matching/review/cart API, state, UI, styles
server/features/recipes/                  recipe router, service, repository
server/features/shoppingLists/            reusable-list router, service, repository
server/features/planner/                  menu/list routers, services, domain rules, repositories
server/features/qfc/                      QFC router, workflow service, repository, job store
server/infrastructure/database/           runtime database mechanics and schema/migrations
server/infrastructure/kroger/             Kroger client implementations and token/catalog/cart service
server/testing/                            disposable characterization seed support
tests/                                    API, desktop Chromium, mobile smoke, fixtures
```

Dependency direction is one-way: composition imports features; features import shared contracts/utilities and injected infrastructure interfaces; shared modules never import features. SQL stays in repositories or database infrastructure. Kroger HTTP/token behavior stays in infrastructure and reaches feature workflows only through the injected `QfcService`.

## Data and integration safety

Normal startup resolves to `data/grocery-getter.sqlite`. Treat that file, `.env`, credentials, OAuth tokens, and saved settings as local user data.

Characterization setup creates `.cache/tests/characterization.sqlite`, refuses the resolved production path in test mode, resets only that disposable database, and constructs QFC with `FakeKrogerClient`. The fake client returns deterministic locations/products and records cart submissions in memory; it cannot make Kroger requests or mutate a real QFC cart.

`GROCERY_GETTER_DB_PATH` selects a database file. `GROCERY_GETTER_TEST_MODE=1` enables the test reset endpoint and refuses the production database path.

## Local verification

After `npm ci`, install Chromium once with `npx playwright install chromium`.

```powershell
npm run typecheck
npm run build
npm run test:api
npm run test:e2e
npm run test:mobile
npm run test:characterization
```

The complete characterization command runs 7 API tests, 6 desktop Chromium journeys, and 1 mobile smoke journey serially against disposable data and fake QFC.
