# Kroger API Notes for Grocery Helper

Source checked: 2026-07-03.

This project currently builds an approved shopping list and sends it through `server/qfcAdapter.ts`, which is still stubbed. The relevant Kroger docs are the public API docs for OAuth, Locations, Products, and Cart.

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
- Expected settings to add locally: `clientId`, encrypted or local-only `clientSecret`, selected `locationId`, and customer refresh/access token metadata once the customer auth flow is implemented.

## Locations

Use the Location API to resolve a nearby or user-selected QFC store.

- Public Location API rate limit from catalog docs: 1,600 calls per day per endpoint.
- Default location search returns 10 results, with `filter.limit` up to 200.
- The docs note the default radius is 10 miles; widen `filter.radiusInMiles` if increasing the limit.
- Store the selected `locationId` in app settings so product matching can use it.

Likely implementation use:

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
- Store-brand matching should prefer QFC/Kroger/Simple Truth/Private Selection when a reasonable match exists.

Likely matching fields to persist per shopping-list item:

- `productId`
- UPC or cart-add identifier from the product response
- product description/brand/size
- selected quantity
- price/fulfillment/stock snapshot
- match confidence or manual override flag

## Cart

Use Cart API only after customer auth is complete.

- Public Cart API rate limit from catalog docs: 5,000 calls per day.
- Public Cart API description says it adds an item to an authenticated customer's cart.
- Because the current project promise is "Send approved items to QFC", the cart adapter should submit only approved shopping-list rows and should never checkout/place an order.

Implementation note: the OpenAPI document endpoint required authentication, so verify the exact public cart-add request body from the logged-in developer docs before coding the final cart call. Build the adapter so the product matching layer returns the product/cart identifier and the cart layer only handles authenticated submission.

## Suggested Adapter Boundary

Keep `server/qfcAdapter.ts` split into small steps:

1. `getServiceToken()` for Products/Locations.
2. `getCustomerToken()` for Cart.
3. `searchProducts(item, locationId)` returning ranked candidates.
4. `chooseCandidate(candidates, preferStoreBrands)` using store-brand and availability rules.
5. `addToCart(candidate, quantity)` using customer auth.
6. `submitToQfcCart(items)` orchestration with a result that reports matched, skipped, and submitted items.

This keeps product matching testable without requiring a live customer session.
