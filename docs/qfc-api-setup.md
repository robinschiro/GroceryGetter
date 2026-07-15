# QFC/Kroger API Setup

This app has a Kroger API adapter boundary for service-to-service APIs, customer OAuth, store-item matching, and cart mutation. Kroger calls these records products in its external API; Grocery Getter calls them store items.

## Implemented

- Stores Kroger developer app settings in the local SQLite database.
- Requests a service-to-service OAuth token from `https://api.kroger.com/v1/connect/oauth2/token`.
- Searches locations through `GET https://api.kroger.com/v1/locations`.
- Searches store items through Kroger's `GET https://api.kroger.com/v1/products` endpoint.
- Starts customer OAuth through `GET https://api.kroger.com/v1/connect/oauth2/authorize`.
- Handles the OAuth callback through `/api/qfc/oauth/callback`.
- Exchanges authorization codes and refresh tokens through `POST https://api.kroger.com/v1/connect/oauth2/token`.
- Adds matched approved items through `PUT https://api.kroger.com/v1/cart/add`.
- Falls back to a non-mutating response when credentials or customer OAuth are not configured.

## Local API Endpoints

- `GET /api/qfc/status`
- `PUT /api/qfc/settings`
- `GET /api/qfc/locations?query=98115`
- `GET /api/qfc/store-items?term=milk&locationId=<locationId>`
- `GET /api/store-item-preferences`
- `DELETE /api/store-item-preferences/:provider/:ingredientKey`
- `PUT /api/store-item-reviews/:jobId/selections/:shoppingItemId`
- `POST /api/store-item-reviews/:jobId/items/:shoppingItemId/search`
- `DELETE /api/store-item-reviews/:jobId/items/:shoppingItemId`
- `POST /api/qfc/oauth/start`
- `GET /api/qfc/oauth/callback`
- `POST /api/qfc/oauth/refresh`

## Settings

The UI writes these server-side settings:

- `krogerClientId`
- `krogerClientSecret`
- `krogerLocationId`
- `krogerServiceScopes`
- `krogerCustomerScopes`
- `krogerRedirectUri`

The current default service scope is `product.compact`.
The current default customer scope is `cart.basic:write`.

The database also stores customer OAuth state and token metadata after authorization:

- `krogerCustomerOAuthState`
- `krogerCustomerAccessToken`
- `krogerCustomerRefreshToken`
- `krogerCustomerTokenExpiresAt`
- `krogerCustomerGrantedScopes`
- `krogerCustomerTokenType`

## Customer OAuth

Register this redirect URI in the Kroger developer app:

```text
http://127.0.0.1:5174/api/qfc/oauth/callback
```

When using the app from a phone or another device through the PC's LAN or Tailscale IP, also register the Vite-hosted callback URL for that host:

```text
http://<pc-lan-or-tailscale-ip>:5173/api/qfc/oauth/callback
```

For example, if the phone opens Grocery Getter at `http://100.101.102.103:5173/`, register:

```text
http://100.101.102.103:5173/api/qfc/oauth/callback
```

Then use the app's `Start customer OAuth` button. When the app is opened from a non-localhost browser, it automatically uses that browser's current origin for the callback so Kroger redirects back to the PC-hosted app instead of the phone's own `127.0.0.1`.

The app stores customer tokens server-side only:

- `krogerCustomerAccessToken`
- `krogerCustomerRefreshToken`
- `krogerCustomerTokenExpiresAt`
- `krogerCustomerGrantedScopes`
- `krogerCustomerTokenType`

## Cart Submission

Current cart submission behavior:

- Searches Kroger store items using the shopping-list `item` text.
- Reuses a remembered ingredient-to-store-item choice when one exists.
- Prefers in-stock store items when stock data is present.
- Prefers Kroger/QFC/Simple Truth/Private Selection brands when the store-brand setting is enabled.
- Falls back to those general availability and store-brand preferences when an ingredient has no remembered store item.
- Shows a review where each approved ingredient can be mapped to a different store item; changes are remembered immediately.
- Allows a custom search term during review and replaces that ingredient's dropdown with the new results.
- Allows unmatched ingredients to be searched manually and promoted into the matched review list when results are found.
- Allows an ingredient to be removed from the current review and cart submission without changing the saved shopping list or its remembered store-item preference.
- Shows the selected store item's Kroger image when the API provides one.
- Requires explicit confirmation from the review step before mutating the cart.
- Adds one cart unit per approved grocery row.
- Uses `PICKUP` as the cart modality.
- Reports matched, skipped, and submitted counts.
- Returns stub-mode messages instead of mutating the cart when Kroger credentials or customer OAuth are missing.

The current add-to-cart payload is:

```json
{
  "items": [
    {
      "upc": "store item upc",
      "quantity": 1,
      "modality": "PICKUP"
    }
  ]
}
```

## Next Cart Work

Cart mutation is enabled, but it still needs review polish before it should be trusted for a full real grocery run:

1. Let the user search beyond the first candidate page during review.
2. Let the user choose package/cart quantities instead of always sending quantity `1`.
3. Improve unit display and package conversion.

The app must never checkout or place the order.
