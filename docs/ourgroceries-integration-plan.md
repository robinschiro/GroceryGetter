# OurGroceries integration plan

## Summary

Grocery Getter integrates with OurGroceries through the private web API used by established community clients. A user connects an account by entering its email address and password in Grocery Getter. The server stores those credentials locally, establishes an authenticated OurGroceries web session when needed, and performs only read-only list operations.

Each menu may select one OurGroceries shopping list. When ingredients are aggregated, Grocery Getter retrieves the selected list's current active items and saves a menu-scoped snapshot. Remote items participate in grouping and approval like local ingredients, while retaining a link to the exact OurGroceries list.

The integration also supports a data-scope-specific default list. The default is applied only when a new menu draft is generated; existing drafts and saved menus retain their own selection.

## Why the MCP approach was replaced

The original plan used OurGroceries' experimental MCP endpoint with dynamic OAuth client registration and authorization-code OAuth with PKCE. Live protocol testing found that this could not be completed by Grocery Getter:

- Dynamic registration rejected the `Grocery Getter` client name because OurGroceries only accepts approved client identities.
- An approved third-party identity could register, but the returned registration was restricted to callback URLs owned by that third party.
- A Grocery Getter callback URL was rejected by the authorization server.
- Impersonating an approved client would misrepresent Grocery Getter and would still not provide a valid callback URL under Grocery Getter's control.

This means the MCP flow cannot be enabled solely through changes in this repository. OurGroceries would need to approve Grocery Getter's client identity and callback URLs.

Rather than block the feature on that external approval, the implementation uses the credential-based web API that existing community integrations have used. The protocol-specific behavior remains isolated behind an adapter so it can be replaced with MCP OAuth later if OurGroceries opens registration to Grocery Getter.

## Credential-based adapter

The adapter performs the following sequence:

1. Submit the account email, password, and `sign-in` action to the OurGroceries sign-in form.
2. Capture the returned `ourgroceries-auth` session cookie in server memory.
3. Load the authenticated lists page and extract the account team ID.
4. Send the read-only `getOverview` command to retrieve shopping lists.
5. Send the read-only `getList` command only for the list selected by the menu.

The adapter does not poll, invoke list or item mutation commands, or expose the session cookie to the frontend. Requests use a bounded timeout, retry once after an expired authenticated session, and return a reconnect message when the saved credentials are rejected.

Canonical list links use the authenticated website pattern:

```text
https://www.ourgroceries.com/your-lists/list/{listId}
```

## Credential storage and safety

- The account email and password are stored in the local Grocery Getter SQLite database.
- The password is not encrypted at rest. Anyone with access to the database file may be able to read it.
- Credentials, passwords, and session cookies are never logged or included in API responses.
- Status responses include only a masked account label and whether credentials are stored.
- A new credential pair is persisted only after a successful sign-in and authenticated overview request.
- Disconnect deletes the saved email and password and clears the in-memory session.
- Retired MCP registration, OAuth token, verifier, state, redirect, and discovery settings are deleted when credential settings are saved or disconnected.
- Connection, credential-update, and disconnect controls are restricted to production mode.
- Sandbox may use the shared read-only connection, while its default-list preference remains isolated from production.

## Settings page

The `/settings/ourgroceries` page provides:

- Connection status and a masked account label.
- Email and password fields for connecting or updating credentials.
- Disconnect and list-refresh actions.
- Available-list preview with direct external links.
- A `Default list for new menus` selector with a `No default` option.
- A warning when the saved default is no longer returned by OurGroceries.
- An explanation that credentials are local and that the private API may change.

OurGroceries list rows use dedicated light- and dark-mode styling, including readable primary and secondary text, hover feedback, and a visible keyboard focus ring.

## Default-list behavior

- Default-list preferences are stored independently for production and sandbox data scopes.
- A currently available default is preselected when a new menu draft is generated.
- A user may change or deselect the list for that menu.
- Changing the setting does not modify an active draft or a saved menu.
- An unavailable default remains visible as a warning and is not silently replaced.
- A disconnected or unavailable default is not applied to a newly generated menu.

## Menu planning

Menu planning contains a single-select `OurGroceries list` control with:

- `Do not include`.
- Every currently available remote shopping list.
- The saved list name when a previously selected list is temporarily unavailable.

Saved menus persist the selected list's string ID, canonical name, and verified web URL. This metadata remains usable for provenance and navigation when the remote catalog cannot be loaded.

## Active-item handling

OurGroceries' current response marks historical or crossed-off items with a `crossedOffAt` field. Active items omit that field. The adapter therefore treats an item as crossed off when it has a meaningful `crossedOffAt` value. It also accepts the older `crossedOff` representation for compatibility with existing clients and fixtures.

Only items that are not crossed off are included in aggregation. Their names are preserved verbatim, and quantity and unit remain blank.

This distinction is important because `getList` may return both active items and items that have previously appeared on the list. Filtering only a `crossedOff` boolean incorrectly treats the entire history as active.

## Snapshots, aggregation, and rollback

- The selected remote list is fetched before any local aggregation data is modified.
- Remote items are stored as a menu-scoped snapshot.
- Snapshot replacement and aggregate replacement occur in one local database transaction.
- A successful refresh completely replaces the previous remote snapshot.
- If authentication or retrieval fails, the previous snapshot and aggregate remain unchanged.
- Re-running aggregation refreshes the snapshot from the current remote list.
- OurGroceries sources remain read-only. Local approval and aggregate editing are available, but `Save to source` is not.

## Provenance and external links

Shopping-list provenance is represented as a discriminated union:

- Recipe and reusable-list sources use numeric Grocery Getter IDs and local navigation.
- OurGroceries sources use `type: "ourGroceries"`, a string list ID, canonical name, and web URL.

Aggregated ingredients and QFC store-item review show all contributing sources together. OurGroceries links:

- Open the exact remote list in a new tab.
- Use `rel="noopener noreferrer"`.
- Use an accessible label such as `Open Costco in OurGroceries`.
- Do not trigger Grocery Getter's internal router.

Mixed local and remote groups retain every source link.

## Local APIs

The implemented API surface is:

- `GET /api/ourgroceries/status`
- `PUT /api/ourgroceries/connection`
- `DELETE /api/ourgroceries/connection`
- `GET /api/ourgroceries/lists`
- `PUT /api/ourgroceries/default-list`
- `PUT /api/menus/:id/ourgroceries-list`

The rejected OAuth design's `/oauth/start` and `/oauth/callback` routes are not present.

## Shared contracts

`OurGroceriesListSummary` contains:

- `id: string`
- `name: string`
- `webUrl: string`

`OurGroceriesStatus` contains connection state, a masked account label, stored-credential state, the scoped default list, and default availability.

`Menu` contains:

- `ourGroceriesList: OurGroceriesListSummary | null`

Remote shopping-list provenance contains:

- `type: "ourGroceries"`
- `id: string`
- `name: string`
- `webUrl: string`

## Verification plan

Automated tests use an injected fake OurGroceries client and never contact the live service. Coverage includes:

- Production-only credential controls and sandbox restrictions.
- Password masking and disconnect behavior.
- Production/sandbox default isolation and stale-default warnings.
- Defaults applying only to newly generated menus.
- Per-menu override and deselection persistence.
- `crossedOffAt` parsing and active-item filtering.
- Snapshot replacement, grouping, provenance, and failed-refresh rollback.
- Read-only remote-source behavior.
- Exact external links in aggregated and QFC review views.
- Mixed local and remote provenance.
- Dark-mode list-row contrast and keyboard focus styling.

Required verification commands are typecheck, API tests, production build, and desktop/mobile Playwright suites.

An optional live smoke test may use an authorized disposable account to verify sign-in, list discovery, default selection, direct links, active-item filtering, aggregation, credential masking, and disconnect. Disposable credentials and temporary databases must be removed after testing.

## Known risks and future migration

- The web API is private and may change without notice.
- Stored credentials are local but not encrypted at rest.
- OurGroceries may add rate limits or change its authentication/session behavior.
- Protocol parsing and URL construction must remain confined to the adapter.
- The integration should migrate to MCP OAuth if OurGroceries approves Grocery Getter as a client with callback URLs controlled by Grocery Getter.

Until that migration is possible, the integration remains read-only, fetches only the selected list during aggregation, and avoids background polling to minimize service load.
