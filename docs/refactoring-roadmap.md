# Grocery Getter Maintainability Roadmap

## Summary

Create `docs/refactoring-roadmap.md` containing this roadmap and use it as the milestone checklist.

The goal is to replace the frontend, API, persistence, QFC, and CSS monoliths with understandable feature-oriented modules. Refactoring begins only after a complete characterization suite covers the current workflows. Existing HTTP contracts, persisted data, routes, and general appearance remain stable, although small product cleanups may be included and reflected in the tests.

## Progress

Phases 1 and 2 were completed on 2026-07-29. No phase 3 feature extraction has started.

- Phase 1 testability seams were committed in `9f59f33`:
  - `GROCERY_GETTER_DB_PATH` selects the database while normal startup retains `data/grocery-getter.sqlite`.
  - Test-mode startup refuses the resolved production database path.
  - `createDatabase({ filePath })` returns an instance with initialization, query, mutation, transaction, persistence, reset, and close operations.
  - `createApp({ database, qfcService, testMode })` composes Express without initializing data or opening a port.
  - Kroger token exchange, location search, product search, and cart submission use an injectable `KrogerClient`.
  - Test mode installs `FakeKrogerClient`, whose deterministic searches and in-memory cart submissions cannot make Kroger network requests or mutate a real cart.
  - `POST /api/test/reset` is registered only in test mode and resets/seeds the injected disposable database.
- Phase 2 characterization was committed in `80bb966`:
  - Playwright is the only test framework. The `api`, `chromium`, and `mobile-smoke` projects run serially with one worker.
  - Global test setup constructs the API and production-preview frontend in-process against `.cache/tests/characterization.sqlite`.
  - Every test resets and seeds deterministic disposable data. The suite covers the application shell, recipes, reusable shopping lists, planner, aggregation, settings, fake-QFC review/submission, API errors, scope isolation, and mobile navigation/overflow.
  - After `npm install`, run `npx playwright install chromium` once to install the local browser binary.
  - Local scripts are available as `npm run test:api`, `npm run test:e2e`, `npm run test:mobile`, `npm run test:characterization`, `npm run test:headed`, and `npm run test:ui`.
  - No CI configuration was added.

Phase 3 foundation extraction started on 2026-07-29:

- Cross-process domain and response contracts now live in `shared/contracts`.
- The frontend uses a data-scope-bound API client from `src/shared`; individual requests no longer read browser storage.
- Lightweight route parsing and route construction live in `src/app/router.ts`.
- `src/main.tsx` now only imports the global stylesheet and mounts the application.
- The existing ingredient-add focus behavior was made conditional so its deferred focus cannot steal focus from a user's next field. The recipe characterization journey covers this behavior and passed three consecutive runs after the cleanup.
- Feature UI/state and feature CSS remain in the application module until each phase 4 vertical slice moves them to their final owner.

Phase 4 recipe extraction started on 2026-07-29:

- Recipe HTTP calls now live behind `src/features/recipes/api.ts`.
- Recipe routes are mounted from a feature router with validation/workflow behavior in a service and all recipe SQL/row mapping in an explicitly injected repository.
- The superseded recipe handlers, validation, and row mapping were removed from `server/app.ts`.
- Recipe page/component and style ownership remain to be moved before the recipe slice is complete.

Phase 4 reusable shopping-list extraction started on 2026-07-29:

- Reusable shopping-list HTTP calls now live behind `src/features/shoppingLists/api.ts`.
- Reusable shopping-list routes, validation/workflow behavior, and persistence are separated into a feature router, service, and explicitly injected repository.
- The superseded shopping-list handlers, validation, item replacement, row mapping, and text helper were removed from `server/app.ts`.
- Shopping-list page/component and style ownership remain to be moved before the slice is complete.

Phase 4 planner extraction started on 2026-07-29:

- Menu creation/editing and generated shopping-list HTTP calls now live behind `src/features/planner/api.ts`.
- Shopping-list quantity parsing/formatting and ingredient normalization now live in the planner domain module.
- Generated shopping-list row mapping and source-target queries now live in the explicitly injected planner repository.
- Menu preview, creation, retrieval, meal editing, recipe replacement, and reusable-list selection now run through a thin planner router, workflow service, and explicitly injected repository.
- Planner page/state/style ownership and the remaining generated-shopping-list route/service split remain to be completed.

The completion run passed typecheck, production build, 7 API tests, 6 desktop Chromium journeys, and 1 mobile smoke journey. The full run also compared the production database SHA-256 before and after execution; it was unchanged.

Target organization:

```text
shared/contracts
src/app
src/features/{recipes,shopping-lists,planner,qfc}
src/shared
server/features/{recipes,shopping-lists,planner,qfc}
server/infrastructure/{database,kroger}
tests/{api,e2e,fixtures}
```

No arbitrary file-size limits will be imposed. Completion is based on clear ownership and dependency boundaries.

## Implementation Roadmap

### 1. Establish safe testability seams — Complete

- Make the database path configurable through `GROCERY_GETTER_DB_PATH`, retaining `data/grocery-getter.sqlite` as the normal default.
- Refuse to start in test mode if the resolved test database is the production database.
- Replace the database singleton incrementally with a `createDatabase({ filePath })` instance exposing query, mutation, transaction, persistence, initialization, and test-reset operations.
- Split API composition from process startup:
  - `createApp({ database, qfcService })` constructs and returns the Express application.
  - The server entry point resolves production configuration, initializes dependencies, and listens.
  - Importing the application factory must not initialize data or open a port.
- Introduce an injectable Kroger client boundary for token exchange, location/product search, and cart submission.
- Supply a deterministic fake Kroger client in test mode. It must never perform network requests or mutate a real cart.
- Register a reset/seed endpoint only when `GROCERY_GETTER_TEST_MODE=1`; return 404 in every normal environment.
- Verify this bootstrap with typecheck, build, and smoke requests against `.cache/tests/`, never against user data.

### 2. Add the complete characterization suite — Complete

Install Playwright as the only initial test framework and add local scripts for API tests, browser tests, headed/UI mode, and the full characterization suite. Do not add GitHub Actions.

Configure three Playwright projects:

- `api`: HTTP characterization against the disposable database.
- `chromium`: complete desktop user journeys.
- `mobile-smoke`: responsive shell and navigation checks at a phone viewport.

Run projects serially initially so database resets cannot race. Reset and seed the disposable database before every test. Use accessible role, label, and text locators; introduce stable test IDs only for ambiguous repeated rows. Avoid fixed sleeps—poll asynchronous QFC jobs and wait on observable UI or HTTP state.

The characterization gate must cover:

- Application shell: direct routes, browser history, navigation, theme persistence, refresh, production/sandbox switching, and scope isolation.
- Recipes: create, validation, edit, delete confirmation, search, filtering, pagination where applicable, menu-generation toggle, ingredient ordering, and deep links.
- Reusable shopping lists: create, validation, case-insensitive name conflict, edit, delete, item ordering, default inclusion, and deep links.
- Planner: menu preview/generation, saving, latest-menu loading, recipe replacement, empty slots, adding/removing meals, and reusable-list selection.
- Aggregated shopping lists: quantity grouping, source provenance, approval changes, editing and saving back to a source, dirty-state behavior, clearing, and regeneration.
- Settings: scoped preferences, production-only credential/OAuth restrictions, and sandbox cart-mutation safeguards.
- QFC review using the fake Kroger client: matching, unmatched items, candidate selection, remembered preferences, quantity changes, custom search, item removal/restoration behavior, job polling, fake cart submission, and failure responses.
- API error behavior: invalid identifiers and payloads, missing resources, scope violations, duplicate data, and relevant status/response shapes.
- Mobile smoke: opening/closing navigation, reaching every primary view, data-mode banner, and absence of major horizontal overflow.

Use deterministic fixtures with the minimum recipes needed for each category. For randomized menu behavior, assert valid membership and invariants rather than a particular random choice.

No production feature extraction begins until the full suite passes repeatedly from a clean disposable database.

### 3. Extract shared foundations and the application shell

- Move cross-process TypeScript contracts—data scope, recipes, menus, shopping lists, settings, store candidates, QFC jobs, and request/response payloads—into `shared/contracts`.
- Preserve all existing HTTP paths, methods, headers, payloads, response shapes, and error semantics.
- Extract a frontend API client that accepts the active data scope explicitly instead of reading global browser state for each request.
- Reduce the root React component to application shell concerns: theme, data scope, navigation, active route, and feature-page composition.
- Move the existing lightweight history router into the app layer; do not introduce React Router.
- Keep React hooks and plain context for genuinely cross-cutting shell state. Do not introduce a server-state or global-state library.
- Split global CSS into tokens/base, shell/navigation, and feature-owned styles. Retain plain CSS and existing class behavior rather than converting to CSS Modules or a styling framework.

### 4. Refactor features in vertical slices

Process features in this order: recipes, reusable shopping lists, planner/generated shopping list, then QFC. Keep the complete characterization suite green after every slice.

For each slice:

- Frontend:
  - Give the feature page ownership of its loading, mutations, messages, and transient UI state.
  - Separate orchestration hooks from presentational components when that produces a clear interface.
  - Reuse feature API functions and domain types rather than duplicating fetch logic.
  - Avoid generic abstractions until at least two features require the same behavior.
  - Co-locate feature-specific CSS with the feature.
- Server:
  - Move routes into a feature router.
  - Put workflow and validation logic into a feature service.
  - Put SQL and row mapping into feature repositories.
  - Keep route handlers limited to HTTP parsing, invoking the service, and mapping results/errors.
  - Pass database and external-service dependencies explicitly.
- Verification:
  - Run typecheck, production build, API characterization, desktop E2E, and mobile smoke tests.
  - Remove superseded code immediately so old and new implementations do not coexist.
  - Document any product cleanup included in the extraction and update the relevant characterization expectation in the same change.

Feature-specific boundaries:

- Recipes own recipe validation, ingredient replacement, generation eligibility, forms, management views, and recipe persistence.
- Reusable shopping lists own list validation, ordering, default inclusion, forms, management views, and persistence.
- Planner owns menu creation/editing and coordinates generated shopping-list behavior.
- Shopping-list aggregation becomes a focused planner domain service covering normalization, quantity combination, source provenance, approval, and save-to-source behavior.
- QFC owns settings, OAuth orchestration, store preferences, matching/review jobs, and the frontend review experience.
- Kroger-specific HTTP/token behavior remains isolated behind the infrastructure client and must not leak into feature routes or React components.

### 5. Complete infrastructure cleanup

- Leave the server entry point responsible only for configuration, dependency construction, initialization, listening, and fatal startup reporting.
- Leave the frontend entry point responsible only for importing base styles and mounting the application.
- Separate schema initialization/migration logic from runtime database query helpers while preserving the current schema and migrations.
- Remove remaining global mutable dependencies except intentionally process-local QFC job state encapsulated by a job-store class.
- Replace duplicated response and row types with shared contracts plus local persistence-only row types.
- Check dependency direction: app composition may import features; features may import shared contracts/utilities; shared modules must never import features.
- Remove dead styles, unused exports, and temporary compatibility facades.
- Update development documentation with the architecture, dependency rules, test commands, disposable-data guarantee, and fake-QFC behavior.

## Interfaces and Compatibility

New developer-facing interfaces:

- `GROCERY_GETTER_DB_PATH`: optional database file override.
- `GROCERY_GETTER_TEST_MODE=1`: enables disposable test controls.
- `createDatabase({ filePath })`: constructs an isolated database instance.
- `createApp({ database, qfcService })`: constructs the Express app without listening.
- `KrogerClient`: external integration interface with production and deterministic fake implementations.
- Shared request/response/domain contracts imported by both frontend and server.

Compatibility requirements:

- Normal startup continues using `data/grocery-getter.sqlite`.
- Tests never read, copy, reset, or write the normal database.
- No database schema or user-data migration is planned.
- Existing `/api/...` contracts and `X-Data-Scope` behavior remain compatible.
- QFC test mode cannot contact Kroger, regardless of locally configured credentials.
- Small behavior/UI cleanups are allowed during extraction, but must be explicit and covered by updated tests.

## Completion Criteria

The roadmap is complete when:

- All characterization tests pass locally from a clean checkout and disposable database.
- `src/main.tsx` only mounts the app, while the app shell composes independently owned feature pages.
- The server entry point only composes and starts the application.
- Express handlers are thin and domain/SQL/external-integration responsibilities have clear owners.
- The original monolithic stylesheet has been replaced by base, shell, and feature-owned styles.
- No feature reaches directly into another feature’s internal modules.
- Typecheck and production build pass.
- The real database, secrets, OAuth tokens, and QFC cart have remained untouched by automation.
- Architecture and local testing instructions are documented.

## Assumptions

- This is a full-stack refactor covering frontend, server, persistence boundaries, QFC integration, and CSS.
- The full characterization suite precedes structural feature extraction.
- Chromium desktop receives full coverage; mobile receives shell/navigation smoke coverage.
- Tests remain local during this roadmap; no CI configuration is added.
- Minimal dependencies are preferred: Playwright is the only new framework required initially.
- Unit tests and Vitest are explicitly out of scope and may be proposed in a later roadmap.
- Maintainability is judged by ownership, dependency direction, and readability—not line counts.
