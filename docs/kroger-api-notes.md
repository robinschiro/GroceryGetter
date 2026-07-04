# Kroger API Notes for Grocery Helper

Source checked: 2026-07-03.

This project builds an approved shopping list and sends it through `server/qfcAdapter.ts`. The adapter now performs service-to-service auth, customer OAuth, location search, product search, product selection, and cart mutation. The relevant Kroger docs are the public API docs for OAuth, Locations, Products, and Cart.

## Relevant Public APIs

| API | Current public version seen | Why it matters here |
| --- | --- | --- |
| Authorization Endpoints | 1.0.17 | Required for access tokens. Product and Location lookup can use service-to-service auth; Cart needs customer auth because it modifies a shopper cart. |
| Location API | 1.2.3 | Needed to store/select the QFC/Kroger `locationId` so product search can return local price, fulfillment, aisle, and stock fields. |
| Product API | 1.3.0 | Needed to match recipe/shopping-list items to concrete Kroger products/UPCs. |
| Cart API | 1.2.3 | Needed to add approved matched products to the authenticated customer's cart. |

The Partner APIs expose broader cart/catalog functionality, but this local desktop app should start with Public APIs unless we later know the Kroger developer account has partner access.

## API Catalog Sources

- Catalog: `https://developer.kroger.com/api-products`
- Public API catalog JSON used by the docs app: `https://developer.kroger.com/api/ui/v1/developer/apis?projections=api.full&filter.hasVersions=true`
- Public OAuth guide: `https://developer.kroger.com/documentation/public/security/guides-oauth`
- Service-to-service auth guide: `https://developer.kroger.com/documentation/public/security/service-to-service`
- Customer auth guide: `https://developer.kroger.com/documentation/public/security/customer`
- Product docs: `https://developer.kroger.com/documentation/api-products/public/products/overview`
- Product search docs: `https://developer.kroger.com/documentation/api-products/public/products/product-search`
- Location docs: `https://developer.kroger.com/documentation/api-products/public/locations/overview`
- Location search docs: `https://developer.kroger.com/documentation/api-products/public/locations/location-search`
- Cart docs: `https://developer.kroger.com/documentation/api-products/public/cart/overview`

## Auth Shape

Use Kroger OAuth2 tokens against Kroger API requests.

- Service-to-service auth is the right default for Locations and Products.
- Customer authorization is required before writing to a customer's cart.
- Store credentials and tokens server-side only. Do not expose the client secret through Vite/client code.
- The implemented local settings are `krogerClientId`, `krogerClientSecret`, `krogerLocationId`, `krogerServiceScopes`, `krogerCustomerScopes`, and `krogerRedirectUri`.
- Customer OAuth stores `krogerCustomerOAuthState`, `krogerCustomerAccessToken`, `krogerCustomerRefreshToken`, `krogerCustomerTokenExpiresAt`, `krogerCustomerGrantedScopes`, and `krogerCustomerTokenType`.
- The default redirect URI is `http://127.0.0.1:5174/api/qfc/oauth/callback`.

## Locations

Use the Location API to resolve a nearby or user-selected QFC store.

- Public Location API rate limit from catalog docs: 1,600 calls per day per endpoint.
- Default location search returns 10 results, with `filter.limit` up to 200.
- The docs note the default radius is 10 miles; widen `filter.radiusInMiles` if increasing the limit.
- Store the selected `locationId` in app settings so product matching can use it.

Implemented app flow:

1. Search locations by zip/address/lat-long.
2. Let the user select the desired QFC/Kroger location.
3. Persist `locationId`.
4. Use that value in Product API `filter.locationId`.

## Products

Use Product API to turn a shopping-list item into a product candidate.

- Public Product API rate limit from catalog docs: 10,000 calls per day.
- Product search supports `filter.limit` and `filter.start`; default page size is 10.
- The docs warn fuzzy search ordering can change between requests.
- Include `filter.locationId` to get local price, fulfillment booleans, aisle locations, and inventory `stockLevel`.
- The docs define inventory values as `HIGH`, `LOW`, and `TEMPORARILY_OUT_OF_STOCK`.
- Store-brand matching prefers QFC/Kroger/Simple Truth/Private Selection when the `preferStoreBrands` setting is enabled.

The implemented matching step currently returns transient product candidates with:

- `productId`
- UPC
- product description/brand/size
- stock level
- price
- store-brand flag

Product selections are not persisted on shopping-list rows yet. The current submit path searches by each approved row's `item` text, chooses one candidate, and submits that UPC directly.

## Cart

Use Cart API only after customer auth is complete.

- Public Cart API rate limit from catalog docs: 5,000 calls per day.
- Public Cart API description says it adds an item to an authenticated customer's cart.
- The adapter submits only approved shopping-list rows and never checks out or places an order.
- If Kroger credentials are missing, `submitToQfcCart` returns a stub-mode message and does not call Kroger.
- If customer OAuth is missing, product/location APIs can still work, but cart mutation returns a stub-mode message.
- When customer OAuth is present, the adapter matches approved rows, adds one `PICKUP` cart unit per matched UPC through `PUT https://api.kroger.com/v1/cart/add`, and reports matched, skipped, and submitted counts.

Current cart-add request body:

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

Implementation note: the OpenAPI document endpoint required authentication when these notes were first written. If cart add starts failing against Kroger, verify the exact public cart-add request body from the logged-in developer docs.

## Current Adapter Boundary

`server/qfcAdapter.ts` is split into these steps:

1. `getServiceToken()` for Products/Locations.
2. `getCustomerAccessToken()` and `refreshCustomerToken()` for Cart.
3. `searchProducts(item, locationId)` returning ranked candidates.
4. `chooseProductCandidate(candidates)` using store-brand and availability rules.
5. `addMatchedItemsToCart(matches)` using customer auth.
6. `submitToQfcCart(items)` orchestration with a result that reports matched, skipped, and submitted items.

This keeps product matching testable without requiring a live customer session.

## Remaining Cart Work

Cart mutation is implemented, but it still needs product-review polish before it should be trusted for a full real grocery run:

1. Add a product matching review screen before submission.
2. Persist selected product/cart identifiers for each approved shopping-list row.
3. Let the user choose package/cart quantities instead of always sending quantity `1`.
4. Improve unit display and package conversion.
