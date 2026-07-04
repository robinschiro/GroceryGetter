# QFC/Kroger API Setup

This app now has a Kroger API adapter boundary for public service-to-service APIs.

## Implemented

- Stores Kroger developer app settings in the local SQLite database.
- Requests a service-to-service OAuth token from `https://api.kroger.com/v1/connect/oauth2/token`.
- Searches locations through `GET https://api.kroger.com/v1/locations`.
- Searches products through `GET https://api.kroger.com/v1/products`.
- Starts customer OAuth through `GET https://api.kroger.com/v1/connect/oauth2/authorize`.
- Handles the local OAuth callback at `http://127.0.0.1:5174/api/qfc/oauth/callback`.
- Exchanges authorization codes and refresh tokens through `POST https://api.kroger.com/v1/connect/oauth2/token`.
- Adds matched approved items through `PUT https://api.kroger.com/v1/cart/add`.

## Local API Endpoints

- `GET /api/qfc/status`
- `PUT /api/qfc/settings`
- `GET /api/qfc/locations?query=98115`
- `GET /api/qfc/products?term=milk&locationId=<locationId>`
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

## Customer OAuth

Register this redirect URI in the Kroger developer app:

```text
http://127.0.0.1:5174/api/qfc/oauth/callback
```

Then use the app's `Start customer OAuth` button. Kroger should redirect back to the local API after approval, and the local callback page should say authorization is complete.

The app stores customer tokens server-side only:

- `krogerCustomerAccessToken`
- `krogerCustomerRefreshToken`
- `krogerCustomerTokenExpiresAt`
- `krogerCustomerGrantedScopes`

## Cart Submission

Current cart submission behavior:

- Searches Kroger products using the shopping-list `item` text.
- Prefers in-stock products when stock data is present.
- Prefers Kroger/QFC/Simple Truth/Private Selection brands when the store-brand setting is enabled.
- Adds one cart unit per approved grocery row.
- Uses `PICKUP` as the cart modality.
- Reports matched, skipped, and submitted counts.

The current add-to-cart payload is:

```json
{
  "items": [
    {
      "upc": "product upc",
      "quantity": 1,
      "modality": "PICKUP"
    }
  ]
}
```

## Next Cart Work

Cart mutation is enabled, but it still needs product-review polish before it should be trusted for a full real grocery run:

1. Add a product matching review screen before submission.
2. Persist selected product/cart identifiers for each approved shopping-list row.
3. Let the user choose package/cart quantities instead of always sending quantity `1`.
4. Improve unit display and package conversion.

The app must never checkout or place the order.
