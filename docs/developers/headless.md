# Headless API

Use the JSON API from a custom storefront (Hydrogen, Next.js), a mobile app or a server. The same endpoints power the theme widgets.

## Turn it on

1. The shop needs the **Pro** plan or higher.
2. In the app, go to **Developers** and turn on **Allow headless requests**.
3. Optional: list the browser origins allowed to call the API (for example `https://www.example.com`). Leave it empty to allow any origin. Server-to-server requests (no `Origin` header) only need steps 1 and 2.

Requests from the shop's own storefront domains always work and don't count as headless.

## Authenticate

Send `shop` (the `.myshopify.com` domain) and `key` (the public key from **Developers**) as query parameters on every request:

```bash
curl "https://<endpoint>/v1/search?shop=acme.myshopify.com&key=pk_…&q=dress&per_page=24"
```

The public key identifies the shop. It isn't a secret, so you can use it in browser code.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /v1/search` | Search products with filters, sort and pagination. |
| `GET /v1/collection` | Filter and sort products within a collection (`collection` = handle or numeric id). |
| `GET /v1/suggest` | Instant search suggestions. |
| `GET /v1/config` | Filters, sort options and texts the merchant configured. |
| `POST /v1/events` | Report anonymous analytics events (clicks, add to cart). |

Full schemas: [openapi.yaml](openapi.yaml).

### Filters

Pass filters as JSON in `filters`, keyed by the filter ids from `/v1/config`:

```
filters={"vendor":["Nike","Adidas"],"price":{"min":10,"max":50},"availability":true}
```

Price ranges in `filters` are in the **shop currency, major units** (`10` = $10.00). You can also use Shopify's native URL parameters instead (`filter.p.vendor=Nike&filter.v.price.gte=10`).

### Prices and currency

The API returns prices in the shop's base currency, in minor units (`price_min: 1999` = $19.99), with `currency` set to the shop currency. To show market prices, fetch them from the Storefront API with `@inContext(country:)`, as the theme SDK does. Range facets (`type: "range"`) also use minor units.

## Caching, limits and errors

- Responses are cacheable: `Cache-Control: public, max-age=30, stale-while-revalidate=300`. Changes the merchant saves are purged within a minute.
- Rate limits apply per IP and per shop (by plan). Over the limit you get `429` with a `Retry-After` header. Back off and retry.
- If the search engine is unavailable, the API returns `503`. Fall back to Shopify's native search.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_shop` | `shop` is missing or isn't a `.myshopify.com` domain. |
| 401 | `invalid_key` | `key` doesn't match the shop. |
| 403 | `headless_not_in_plan` | The shop's plan doesn't include headless access. |
| 403 | `headless_disabled` | The merchant hasn't turned on headless access. |
| 403 | `headless_origin_not_allowed` | The browser origin isn't in the allowed list. |
| 404 | `unknown_shop`, `unknown_collection` | The shop doesn't use the app, or the collection doesn't exist. |
| 429 | `rate_limited` | Too many requests. Wait for `Retry-After` seconds. |
| 503 | `engine_unavailable` | Temporary outage. Use native search. |
