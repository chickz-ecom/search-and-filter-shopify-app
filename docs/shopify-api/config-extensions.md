# Shopify config & extensions — verified facts (API 2026-10)

Checked 2026-10-26. Sources: shopify.dev through the Shopify Dev MCP (`search_docs_chunks`, `validate` against the Admin GraphQL 2026-10 schema, `validate_theme` = Theme Check). Local: Shopify CLI 4.9.4, `@shopify/shopify-app-react-router` 4.0.0 in `node_modules`.

What the labels mean:
- **[schema]**: the item passed (or failed) the MCP `validate` tool against the Admin 2026-10 schema.
- **[doc]**: a shopify.dev page says it. The URL is given.
- **[theme-check]**: `validate_theme` passed the file. Theme Check does **not** check Liquid object properties or schema `target` values. It only catches unknown filters, missing assets, and parser-blocking scripts. Object properties below are therefore **[doc]**-verified.

`shopify app config validate --json-schema` does **not** print the TOML schema. CLI output: `This command does not define a JSON output schema.` (That flag is for the command's JSON output.) The TOML facts below come from the docs.

---

## 1. `shopify.app.toml`

Reference: https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration

### Verified syntax
```toml
name = "Search & Filter"            # required
client_id = "..."                   # required
application_url = "https://app.example.com"   # required, valid URL
embedded = true                     # required boolean
handle = "search-filter"            # optional (changing it breaks admin links)
# extension_directories = ["extensions/*"]   # optional, default ["extensions/"]

[access_scopes]
scopes = "read_products,read_inventory,read_product_listings,read_publications,read_translations,read_locales,read_markets,unauthenticated_read_product_listings,write_app_proxy,write_pixels,read_customer_events"
# optional_scopes = ["read_themes"]     # array of strings; requested after install
# use_legacy_install_flow = false       # omit -> Shopify managed install

[auth]
redirect_urls = [ "https://app.example.com/auth/callback" ]   # required array; at least 1 before going public

[webhooks]
api_version = "2026-10"   # required

  [[webhooks.subscriptions]]
  topics = [ "products/create", "products/update", "products/delete" ]  # one subscription may list several topics
  uri = "/webhooks/products"        # HTTPS URL, relative path starting with "/", pubsub://project:topic, or EventBridge ARN
  # filter = "status:active AND variants.price:>=10.00"     # Shopify search syntax
  # include_fields = ["id", "variants.id", "variants.price", "updated_at"]  # nested fields use a dot
  # name = "products-sync"           # optional; echoed in X-Shopify-Name; alnum, -, _, max 50

  [[webhooks.subscriptions]]
  compliance_topics = [ "customers/data_request", "customers/redact", "shop/redact" ]
  uri = "/webhooks/compliance"

[app_proxy]
url = "/proxy"          # relative (CLI prepends app URL) or absolute
prefix = "apps"         # one of: a, apps, community, tools
subpath = "search"      # letters, digits, _, -, max 30 chars; not admin|services|password|login

[pos]
embedded = false        # optional boolean

[build]
automatically_update_urls_on_dev = true   # optional boolean
# dev_store_url = "my-dev.myshopify.com"  # optional
include_config_on_deploy = true           # appears in the official React Router template (see note)
```
Sources:
- Field tables (global, access_scopes, auth, webhooks, app_proxy, pos, build): https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration
- `filter`: https://shopify.dev/docs/apps/build/webhooks/delivery-filtering
- `include_fields`: https://shopify.dev/docs/apps/build/webhooks/delivery-structure
- `name`, several topics per subscription, `compliance_topics`: https://shopify.dev/docs/apps/build/webhooks/subscribe
- App proxy: https://shopify.dev/docs/apps/build/online-store/app-proxies

Notes:
- `compliance_topics` is a **separate key** from `topics`. It can sit in the same `[[webhooks.subscriptions]]` entry as normal `topics`; the docs example puts `topics = ["app/uninstalled"]` and all three compliance topics under one `uri = "/webhooks"`. **[doc]**
- A write scope includes the read scope: `write_products` grants `read_products`. Declaring a read scope as optional while its write scope is required fails to deploy. https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes
- Merchants can change the app proxy `prefix`/`subpath` per store. Changes to them apply to **new installs only**; changes to `url` apply immediately everywhere. **[doc]**
- `include_config_on_deploy` appears in the React Router template example (https://shopify.dev/docs/apps/build/build?framework=reactRouter). It was **not** in the `build` reference table that was retrieved. That table lists only `automatically_update_urls_on_dev` and `dev_store_url`.

### Access scopes (all confirmed to exist)
| Scope | What it grants | Source |
|---|---|---|
| read_products | Product, ProductVariant, Collection… | https://shopify.dev/docs/api/usage/access-scopes |
| read_inventory | InventoryLevel and InventoryItem | https://shopify.dev/docs/api/admin-rest/usage/access-scopes (also required by `inventory_levels/update`) |
| read_product_listings | ProductFeed, `publishedOnCurrentChannel`… | https://shopify.dev/docs/api/usage/access-scopes |
| read_publications | Publication fields on Product/Collection/Variant | https://shopify.dev/docs/api/usage/access-scopes |
| read_translations | Translation, TranslatableResource | https://shopify.dev/docs/api/usage/access-scopes |
| read_locales | ShopLocale ("read_locales or read_markets_home") | https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopLocale |
| read_markets | Market / MarketWebPresence queries | https://shopify.dev/docs/api/admin-graphql/2026-04/objects/MarketWebPresence, plus the MARKETS_* webhook enum in 2026-10 |
| unauthenticated_read_product_listings | Storefront API Product, Collection | https://shopify.dev/docs/api/usage/access-scopes |
| write_app_proxy | App proxy configuration (needed to configure `[app_proxy]`) | https://shopify.dev/docs/api/usage/access-scopes, https://shopify.dev/docs/apps/build/online-store/app-proxies |
| write_pixels, read_customer_events | WebPixel/ServerPixel objects; webPixelCreate/Update/Delete | https://shopify.dev/docs/api/usage/access-scopes, https://shopify.dev/docs/apps/build/marketing/build-web-pixels |

NOT FOUND / UNVERIFIED: `read_locales` and `read_markets` did not appear in the access-scopes **table** chunks that were retrieved. They are confirmed through the 2026-10 GraphQL object docs and the webhook enum descriptions instead.

---

## 2. Webhook topics (2026-10)

**[schema]**: one mutation with 26 `webhookSubscriptionCreate(topic: …)` aliases was checked against the Admin 2026-10 schema. Every non-compliance topic below is a valid `WebhookSubscriptionTopic` value. The three compliance topics are **not** enum values. The validator said, for example, `Value "CUSTOMERS_DATA_REQUEST" does not exist in "WebhookSubscriptionTopic" enum`. That fits the docs: compliance topics are declared only through `compliance_topics`.

| TOML topic | Exists 2026-10 | Required scope (from the 2026-10 enum docs) |
|---|---|---|
| products/create, products/update, products/delete | yes | read_products |
| collections/create, collections/update, collections/delete | yes | read_products |
| inventory_levels/update | yes | read_inventory |
| inventory_items/update | yes | read_inventory **or** read_products |
| product_listings/add, product_listings/update, product_listings/remove | yes | read_product_listings |
| collection_listings/add, collection_listings/update, collection_listings/remove | yes | read_product_listings |
| locales/create, locales/update | yes | read_locales |
| markets/create, markets/update, markets/delete | yes | read_markets |
| app/uninstalled, app/scopes_update | yes | none listed |
| bulk_operations/finish | yes | none listed |
| shop/update | yes | none listed |
| customers/data_request, customers/redact, shop/redact | compliance only (`compliance_topics`) | n/a |

Source: https://shopify.dev/docs/api/admin-graphql/2026-10/enums/WebhookSubscriptionTopic

Important behaviour, quoted from the 2026-10 enum docs:
- `products/update`: "Occurs whenever a product is updated, ordered, or variants are added, removed or updated."
- `collections/update`: "...including when a product is manually added or removed from the collection or when the collection rules change. Occurs once if multiple products are manually added or removed from a collection at the same time. **Not fired when attribute changes affect whether a product matches a collection's rules.**" This means a smart collection gaining or losing members because a product attribute changed does **not** fire `collections/update`.
- Listing topics (`product_listings/*`, `collection_listings/*`) are about publication to **the app's own channel**.

Several topics in one subscription: yes. "You can list multiple topics in a single subscription to route qualifying events from each to the same uri." https://shopify.dev/docs/apps/build/webhooks/subscribe

HMAC check: the `X-Shopify-Hmac-SHA256` header is base64 HMAC-SHA256 of the raw body, keyed with the client secret. `authenticate.webhook(request)` does this check. https://shopify.dev/docs/apps/build/webhooks/verify-deliveries

---

## 3. Events (`[events]`)

Sources:
- https://shopify.dev/docs/apps/build/events/subscribe
- https://shopify.dev/docs/api/events/2026-10
- https://shopify.dev/docs/api/events/2026-10/collection
- https://shopify.dev/docs/api/events/2026-10/product
- https://shopify.dev/docs/api/events/2026-10/inventory-item

Events need Shopify CLI ≥ 3.92 (local CLI is 4.9.4) and can be configured **only** in `shopify.app.toml`.

### Verified syntax
```toml
[events]
api_version = "2026-10"

  [[events.subscription]]            # NOTE: singular "subscription"
  handle = "collection-membership"   # required; alnum, _, -, max 50; sent in payload + Shopify-Handle header
  topic = "Collection"               # required; capitalized GraphQL resource name
  actions = ["create", "update", "delete"]   # required; any combination
  triggers = ["collection.products"] # required when actions includes "update"
  uri = "/api/events/collections"    # required; HTTPS URL, EventBridge ARN, or Pub/Sub URI
  query = """
  query CollectionMembership($collectionId: ID!, $productsId: ID!) {
    collection(id: $collectionId) { id hasProduct(id: $productsId) }
  }
  """                                # optional; result goes in `data`
  # query_filter = "product.status:'ACTIVE'"   # optional; if set, `query` must also be set
```
The example above is from the changelog: https://shopify.dev/changelog/blog/next-generation-events-are-now-generally-available. Its query passed [schema] for 2026-10.

### Collection topic (2026-10)
"Requires read_products access scope. Supported actions: create, update, delete." Triggers confirmed in the 2026-10 reference:
- `collection.*` (parent trigger)
- `collection.descriptionHtml`, `collection.handle`, `collection.image`, `collection.title`, `collection.templateSuffix`
- **`collection.sortOrder`: EXISTS.** "Fires when the sortOrder field on the Collection object changes." Variables: `collectionId`.
- **`collection.products`: EXISTS.** "The products field represents the products that are included in the collection." Variables: `collectionId, productsId`. An addition appears in `fields_changed.added`; a removal appears in `fields_changed.removed` (e.g. `collection[id: '…'].products[id: 'gid://shopify/Product/…']`).
- `collection.metafield(namespace: 'custom', key: 'rating').value`, `collection.metafield(namespace: 'custom').*`

"Calculated fields, derived fields, auto-updated timestamps, and cross-domain fields aren't available as triggers."

### Product topic (2026-10), triggers worth using
Confirmed in the 2026-10 product reference:
- Product fields: `product.title`, `product.handle`, `product.status`, `product.tags`, `product.productType`, `product.templateSuffix`, `product.requiresSellingPlan`, `product.media`
- Variants: `product.variants.*`, `product.variants.price`, `product.variants.compareAtPrice`, `product.variants.inventoryPolicy`, `product.variants.barcodes`, `product.variants.showUnitPrice`, `product.variants.media`, `product.variants.productVariantComponents.*`
- Variant triggers give the variables `productId, variantsId`. Product-level triggers give `productId`.
- `product.vendor` and `product.descriptionHtml` were seen only in the `unstable` and `2027-01` pages. They are UNVERIFIED for 2026-10.
- `product.*` is a parent trigger.

Inventory is a **separate topic**, `InventoryItem` (2026-10). Example trigger: `inventoryItem.inventoryLevel.quantities.quantity`. Parents: `inventoryItem.inventoryLevel.*`, `inventoryItem.inventoryLevel.quantities.*`. Also `inventoryItem.inventoryLevel.isActive` and `inventoryItem.harmonizedSystemCode`. Variables: `inventoryItemId, inventoryLevelId, quantitiesName`.

### Delivery headers (HTTPS)
```
shopify-topic: Collection
shopify-action: update
shopify-handle: collection-event
shopify-api-version: 2026-10
shopify-webhook-id: 7613956a-...      # dedupe key
shopify-triggered-at: 2026-03-23T16:24:35.267Z
shopify-shop-domain: your-shop.myshopify.com
shopify-hmac-sha256: <base64>
```
Header names are case-insensitive (HTTP/2 lowercases them).

### Payload shape
```json
{
  "topic": "Collection",
  "action": "update",
  "handle": "collection-event",
  "data": { "collection": { "id": "gid://shopify/Collection/1", "hasProduct": true } },
  "fields_changed": {
    "added": ["collection[id: 'gid://shopify/Collection/1'].products[id: 'gid://shopify/Product/2']"],
    "updated": [],
    "removed": []
  },
  "query_variables": { "collectionId": "gid://shopify/Collection/1", "productsId": "gid://shopify/Product/2" }
}
```
- `topic`, `action`, `handle` and `fields_changed` are always present. `fields_changed` always has all three arrays.
- `data` and `query_variables` are present only when a `query` is set. That comes from the payload section of https://shopify.dev/docs/api/events/2027-01. However, the example on https://shopify.dev/docs/apps/build/events/subscribe has no query and still includes `query_variables`. Treat `query_variables` as optional in code.
- `errors` appears if the query fails.
- On delete, `data.collection` is `null`. Use `query_variables.collectionId`.
- Large payloads: the delivery carries `payload_url`, `payload_size_bytes` and `expires_at` instead. Limits: HTTPS 5 MB, Pub/Sub 10 MB, EventBridge 256 KB. Check the HMAC on the small payload. https://shopify.dev/docs/apps/build/events/delivery-structure

### HMAC and React Router
Same scheme as webhooks: base64 HMAC-SHA256 of the raw body, keyed with the client secret, in `Shopify-Hmac-Sha256`. The Events docs show **`authenticate.webhook(request)` from the React Router template** doing this check:
```ts
const { shop, session, topic } = await authenticate.webhook(request);
```
https://shopify.dev/docs/apps/build/events/verify-deliveries

### Query cost
"Each Events subscription query has a complexity limit of **100 points**." The check runs at deploy, without executing the query, and the error looks like "Query complexity of 101 exceeds the maximum of 100". `shopify app deploy --no-release` validates without releasing. Scalars and enums cost 0, objects cost 1, connections scale with `first`/`last`. https://shopify.dev/docs/apps/build/events/optimizing-your-subscriptions

### Smart collections and `collection.products`
NOT FOUND / UNVERIFIED. No doc says whether rule-based (smart) collection membership changes fire `collection.products`. The trigger is documented generically: "products that are included in the collection." For comparison, the `collections/update` **webhook** explicitly does **not** fire when a product's attributes change whether it matches the rules. Assume no until tested on a dev store, and keep a reconciliation job (the Events docs recommend one: https://shopify.dev/docs/apps/build/events/optimizing-your-subscriptions, Step 7).

---

## 4. Theme app extension

Source: https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration

### `shopify.extension.toml`
```toml
name = "search-theme"
type = "theme"
# handle = "search-theme"   # optional
```
Folders: `assets/`, `blocks/`, `snippets/`, `locales/` (`en.default.json`, `en.default.schema.json`…).

### Schema attributes (app blocks and app embeds)
- `name`: required. Keep it under 25 characters, without the app title.
- `target`: required.
  - App embeds: `head`, `compliance_head`, or `body`. **`body` is valid.** Embeds are injected before `</head>` / `</body>`.
  - **App blocks: `content` (current).** `section` is a **legacy** value that is "still supported and behaves the same as content, but new app blocks should use content."
- `javascript`: a file in `assets/`, loaded with `<script async>` in `<head>` when the block is on the page, de-duplicated across blocks.
- `stylesheet`: a file in `assets/`, added as `<link rel="stylesheet">` in `<head>`, de-duplicated.
- `enabled_on` / `disabled_on`: use only one of them.
  - App blocks: `{ "templates": [...], "groups": [...] }`.
  - App embeds: templates only.
  - Group values: `header`, `footer`, `aside`, `custom.<NAME>`, or `["*"]`. Template value `["*"]` means all.
  - Blocks never render on checkout pages.
- Also `class`, `tag`, `settings`, `default`, and `available_if`. `available_if` must reference a **boolean app-data metafield**, e.g. `"available_if": "{{ app.metafields.conditional.block1 }}"`.

Setting types follow the theme input settings:
- Basic: `checkbox`, `number`, `radio`, `range`, `select`, `text`, `textarea`
- Specialized: `color`, `image_picker`, `link_list`, `liquid`, `inline_richtext`, etc.

`visible_if` exists for conditional settings. Source: https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings

NOT FOUND / UNVERIFIED: no list was found of setting types that are *excluded* from theme app extensions.

Restrictions:
- Blocks have no access to `content_for_header`, `content_for_index` or `content_for_layout`, and see only `section.id` of the parent section.
- JSON in extension files may **not** contain comments or trailing commas.
- App embeds only see the global Liquid scope of the page.
- `{{ 'file.js' | asset_url }}` inside an extension block refers to the extension's own `assets/` folder. The docs say apps can load assets "using either the JavaScript and stylesheet schema attributes or from the asset_url and asset_img_url Liquid URL filters."

### Limits (enforced at deploy)
| Item | Limit |
|---|---|
| All files in the extension | 10 MB (enforced) |
| Number of blocks | 30 (enforced) |
| Locale files | 100 (enforced), 15 KB each (enforced) |
| Liquid across all files | **100 KB total** (enforced) |
| CSS referenced by the schema | 100 KB compressed (suggested) |
| JS referenced by the schema | 10 KB compressed (suggested) |

### Deep links
- Merchants must activate app embeds themselves; "your app can't activate them on the app user's behalf." Send them to the theme editor with a deep link.
- Detecting whether the embed is on: read `config/settings_data.json` → `current.blocks[*]` with `"type": "shopify://apps/<app>/blocks/<handle>/<uid>"` and `"disabled": false`. This needs `read_themes`.

App block deep link query fragments, verified as shown in the docs:
```
addAppBlockId={api_key}/{handle}&target=newAppsSection          # any JSON template (template=product etc.)
addAppBlockId={api_key}/{handle}&target=mainSection
addAppBlockId={api_key}/{handle}&target=sectionGroup:header      # header|footer|aside
addAppBlockId={api_key}/{handle}&target=sectionId:<section-id>
```
- `{template}` defaults to `index`.
- `{api_key}` is the `client_id`. The older `{uuid}` (extension ID) is deprecated.
- `{handle}` is the block's file name without `.liquid`.

App embed deep link parameters documented:
- `context=apps`
- `template` (`product`, `collection`, `article`, `blog`; default `index`)
- `{api_key}` and `{handle}`
- Host: the `<myshopifyDomain>` value from the Admin `Shop` object

NOT FOUND / UNVERIFIED: the MCP doc chunks drop the full URL strings, so I could not verify these two pieces:
- the exact parameter name `activateAppId`
- the path `https://<myshopifyDomain>/admin/themes/current/editor?…`

The likely form is `…/admin/themes/current/editor?context=apps&template=collection&activateAppId={api_key}/{handle}`. Confirm it on the configuration page above before shipping.

### Validated sample files (Theme Check: PASS)
`extensions/search-theme/blocks/search-embed.liquid` (app embed):
```liquid
<script id="sf-config" type="application/json">
  {
    "shop": {{ shop.permanent_domain | json }},
    "currency": {{ cart.currency.iso_code | json }},
    "shopCurrency": {{ shop.currency | json }},
    "moneyFormat": {{ shop.money_format | json }},
    "moneyWithCurrencyFormat": {{ shop.money_with_currency_format | json }},
    "country": {{ localization.country.iso_code | json }},
    "language": {{ localization.language.iso_code | json }},
    "locale": {{ request.locale.iso_code | json }},
    "pageType": {{ request.page_type | json }},
    "searchUrl": {{ routes.search_url | json }},
    "collectionHandle": {{ collection.handle | json }},
    "collectionId": {{ collection.id | json }},
    "searchTerms": {{ search.terms | json }},
    "proxyPath": {{ block.settings.proxy_path | json }}
  }
</script>
<script src="{{ 'search-embed.js' | asset_url }}" defer></script>

{% schema %}
{
  "name": "Search & Filter",
  "target": "body",
  "stylesheet": "search-embed.css",
  "enabled_on": { "templates": ["collection", "search"] },
  "settings": [
    { "type": "text", "id": "proxy_path", "label": "Proxy path", "default": "/apps/search" },
    { "type": "range", "id": "per_page", "label": "Products per page", "min": 12, "max": 48, "step": 4, "default": 24 },
    { "type": "checkbox", "id": "show_currency", "label": "Show currency code", "default": false },
    { "type": "select", "id": "layout", "label": "Layout",
      "options": [ { "value": "grid", "label": "Grid" }, { "value": "list", "label": "List" } ],
      "default": "grid" }
  ]
}
{% endschema %}
```
`extensions/search-theme/blocks/search-results.liquid` (app block). The correction from my first draft: `"target": "content"` instead of `"section"`.
```liquid
<div class="sf-results" data-page-type="{{ request.page_type }}">
  {% if request.page_type == 'search' %}
    {% paginate search.results by block.settings.per_page %}
      {% for item in search.results %}
        {% if item.object_type == 'product' %}
          <a href="{{ item.url }}">{{ item.title | escape }}</a>
          {% if block.settings.show_currency %}{{ item.price | money_with_currency }}{% else %}{{ item.price | money }}{% endif %}
        {% endif %}
      {% endfor %}
      {{ paginate | default_pagination }}
    {% endpaginate %}
  {% endif %}
</div>

{% schema %}
{
  "name": "Search results",
  "target": "content",
  "javascript": "search-results.js",
  "enabled_on": { "templates": ["search", "collection"] },
  "settings": [
    { "type": "range", "id": "per_page", "label": "Results per page", "min": 12, "max": 48, "step": 4, "default": 24 },
    { "type": "checkbox", "id": "show_currency", "label": "Show currency code", "default": false }
  ]
}
{% endschema %}
```
Theme Check rules worth knowing: `<script>` tags without `defer`/`async` are errors, and an `asset_url` pointing to a missing `assets/` file is an error.

---

## 5. Liquid objects and filters

| Item | Verified meaning | Source |
|---|---|---|
| `localization.country` | `country` object, the currently selected country. `.iso_code` is used in the official localization form | https://shopify.dev/docs/api/liquid/objects/localization, https://shopify.dev/docs/storefronts/themes/markets/multiple-currencies-languages |
| `localization.language` | `shop_locale`; `.iso_code` is an IETF tag, e.g. `en` | https://shopify.dev/docs/api/liquid/objects/shop_locale |
| `localization.market` | market for the buyer's country | localization page |
| `request.locale` | `shop_locale` of the request (`.iso_code`). Replaces the deprecated `shop.locale` | https://shopify.dev/docs/api/liquid/objects/request |
| `request.page_type` | values: 404, article, blog, captcha, cart, collection, list-collections, customers/*, gift_card, index, metaobject, page, password, policy, product, search | request page |
| `request.design_mode`, `request.visual_preview_mode` | booleans for the theme editor | request page |
| `cart.currency` | `currency` object (`iso_code`, `name`, `symbol`) = presentment currency | https://shopify.dev/docs/api/liquid/objects/cart, https://shopify.dev/docs/api/liquid/objects/currency |
| `shop.currency` | **string** (store currency, e.g. "CAD"), not an object | https://shopify.dev/docs/api/liquid/objects/shop |
| `shop.money_format`, `shop.money_with_currency_format` | e.g. `"${{amount}}"`, `"${{amount}} CAD"` | shop page |
| `shop.permanent_domain` | e.g. `polinas-potent-potions.myshopify.com` | shop page |
| `collection.handle` (string), `collection.id` (number) | | https://shopify.dev/docs/api/liquid/objects/collection |
| `search.terms` | the entered terms | https://shopify.dev/docs/api/liquid/objects/search |
| `search.results` | articles, pages or products; each has `object_type`; paginate up to 50 per page; covers the first 1,000 results | search page |
| `search.results_count` (max 1,000), `search.performed`, `search.filters`, `search.sort_by`, `search.sort_options`, `search.types` | | search page |
| `{% paginate array by N %}` | N from 1 to 250; `window_size:` option; up to the 25,000th item; paginable arrays include `collection.products` and `search.results` | https://shopify.dev/docs/api/liquid/tags/paginate |
| `routes.search_url` (`/search`), `routes.predictive_search_url` (`/search/suggest`), `routes.root_url` | | https://shopify.dev/docs/api/liquid/objects/routes |
| `money`, `money_with_currency`, `money_without_currency` | money filters | https://shopify.dev/docs/api/liquid/filters/money_with_currency |
| `json` | adds its own quotes. On products it omits variant `inventory_quantity`/`inventory_policy` | https://shopify.dev/docs/api/liquid/filters/json |
| `asset_url` | CDN URL for an `assets/` file. In an app extension it resolves the extension's own assets | https://shopify.dev/docs/api/liquid/filters/asset_url, plus the theme-app-extension configuration page |
| `app.metafields` | metafields owned by the app (used by `available_if`) | https://shopify.dev/docs/api/liquid/objects/app |

Note: `shop.enabled_locales`, `shop.locale`, `shop.metaobjects` and `shop.taxes_included` are deprecated.

NOT FOUND / UNVERIFIED: `localization.country.iso_code` was confirmed only through the docs' localization-form example, not a `country` property table. It is very likely correct.

---

## 6. Web pixel extension

Sources:
- https://shopify.dev/docs/apps/build/marketing/build-web-pixels
- https://shopify.dev/docs/api/web-pixels-api

### `extensions/<name>/shopify.extension.toml`
```toml
type = "web_pixel_extension"
name = "search-pixel"
uid = "..."                     # generated by CLI; don't edit
runtime_context = "strict"      # required, must be "strict"

[customer_privacy]              # if you override, declare all four
analytics = true
marketing = false
preferences = false
sale_of_data = "disabled"       # enabled | disabled | ldu

[settings]
type = "object"

[settings.fields.shopId]        # note: [settings.fields.<key>] (single brackets)
name = "Shop ID"
description = "Internal shop identifier"
type = "single_line_text_field"
```
If `[customer_privacy]` is omitted, the defaults are `marketing: true`, `analytics: true`, `sale_of_data: "enabled"`.

### Register API
```js
import { register } from '@shopify/web-pixels-extension';
register(({ analytics, browser, settings, init, customerPrivacy }) => {
  analytics.subscribe('search_submitted', (event) => { /* ... */ });
});
```
- `settings`: the JSON set with the Admin API (app pixels only).
- `init.data`: `cart`, `customer`, `shop` (`shop.paymentSettings.currencyCode`), `purchasingCompany`. Also `init.customerPrivacy`.
- `browser.cookie`, `browser.localStorage`, `browser.sessionStorage` run asynchronously in the top frame.
- `customerPrivacy.subscribe('visitorConsentCollected', …)`.

### Event payload fields we need
| Event | Path | Notes |
|---|---|---|
| `search_submitted` | `event.data.searchResult.query` (string), `event.data.searchResult.productVariants[]` | the first variant of each returned product; online store only |
| `product_added_to_cart` | `event.data.cartLine.cost.totalAmount.{amount,currencyCode}`, `event.data.cartLine.merchandise` (ProductVariant: `id`, `title`, `price`, `product`…) | |
| `product_viewed` | `event.data.productVariant.{id, price.amount, price.currencyCode, product, sku, title}` | |
| `collection_viewed` | `event.data.collection.{title, productVariants[]}` (e.g. `productVariants[0].price.amount`) | |
| `checkout_completed` | `event.data.checkout.totalPrice?.amount`, `.lineItems[]` (`quantity`, `title`, `variant`, `finalLinePrice`, `discountAllocations`), `.discountApplications`, `.transactions`, `.order` | fires once, usually on the Thank you page |

Common to every event: `id`, `name`, `clientId`, `timestamp`, `seq`, `type`, `context`.

Sources: https://shopify.dev/docs/api/web-pixels-api/standard-events/search_submitted (and `/product_added_to_cart`, `/product_viewed`, `/collection_viewed`, `/checkout_completed`)

PII: since 2025-12-10, customer PII fields are `null` unless the app is approved for the protected scopes. https://shopify.dev/changelog/posts/protected-customer-data-scopes-required

NOT FOUND / UNVERIFIED:
- the exact name of the checkout-level currency field (e.g. `checkout.currencyCode`). Use `checkout.totalPrice.currencyCode` (MoneyV2) instead.
- `collection.id` in the `collection_viewed` payload was not seen in the retrieved chunks.

### Activating the pixel (Admin GraphQL API, **[schema]** VALID for 2026-10)
```graphql
mutation webPixelCreate($webPixel: WebPixelInput!) {
  webPixelCreate(webPixel: $webPixel) {
    userErrors { field message code }
    webPixel { id settings }
  }
}
# variables: { "webPixel": { "settings": { "shopId": "123" } } }   # WebPixelInput.settings: JSON!
mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
  webPixelUpdate(id: $id, webPixel: $webPixel) { userErrors { field message code } webPixel { id settings } }
}
```
- Requires `write_pixels`, plus `read_customer_events` and user access permission.
- Settings must match the extension's settings definition. A mismatch fails with `INVALID_SETTINGS`, e.g. "Missing keys: …".

https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/webPixelCreate

---

## 7. App proxy

Sources:
- https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
- https://shopify.dev/docs/apps/build/online-store/app-proxies

Shopify adds these query parameters to every proxied request:
- `shop`
- `logged_in_customer_id` (empty for guests)
- `path_prefix` (e.g. `/apps/search`; the merchant may customize it, so build links from this value)
- `timestamp`
- `signature`

Other forwarded details:
- Headers `X-Forwarded-Host` and `X-Forwarded-For` are added.
- The `Cookie` and `Set-Cookie` headers are stripped.
- The method and body are forwarded.
- New parameters may appear, so don't hard-code the parameter list.

### Signature algorithm (verified)
1. Parse the query string and remove `signature`.
2. For each key, build `key=value`, joining repeated values with `,`. Example: `extra=1&extra=2` becomes `extra=1,2`.
3. Sort the strings, then concatenate them with **no separator**.
4. Compute `HMAC-SHA256(client secret, string)` as **hex**, and compare it in constant time with `signature`.

Docs example: `"extra=1,2logged_in_customer_id=1path_prefix=/apps/awesome_reviewsshop={shop}.myshopify.comtimestamp=1317327555"`.

The signature only proves the request wasn't tampered with. The app must still check `logged_in_customer_id` before returning customer-owned data.

### React Router (`@shopify/shopify-app-react-router`; the docs exist for v0 through v4, and the repo has 4.0.0)
```ts
import { authenticate } from "../shopify.server";
export const loader = async ({ request }) => {
  const { session, liquid, admin, storefront } = await authenticate.public.appProxy(request);
  if (!session) throw new Response("Unauthorized", { status: 401 }); // app not installed -> session/admin/storefront undefined
  return liquid("Hello {{ shop.name }}", { layout: false });          // Content-Type application/liquid
};
```
- `liquid(body, initAndOptions)` returns a Liquid `Response`. The option `layout: boolean` controls whether the shop's theme layout wraps the output.
- Liquid is rendered only when the response has `Content-Type: application/liquid`. Otherwise the response is returned as-is, and 30x redirects are followed.

Sources:
- https://shopify.dev/docs/api/shopify-app-react-router/v4/authenticate/public/app-proxy
- https://shopify.dev/docs/apps/build/security/app-security-checks/app-proxy-unverified-signature

---

## Assumption check
| Assumption | Verdict |
|---|---|
| Events trigger `collection.sortOrder` exists (2026-10) | **TRUE** |
| Events trigger `collection.products` exists (2026-10) | **TRUE** (`collectionId`, `productsId`). Smart-collection behaviour is **UNVERIFIED** |
| Compliance topics are declared through `compliance_topics` | **TRUE**. They are not `WebhookSubscriptionTopic` enum values |
| App embed `"target": "body"` | **TRUE** (`head`, `compliance_head` and `body` are valid) |
| App block `"target": "section"` | **Legacy.** It still works, but the docs say to use **`"content"`** |
| `[[events.subscriptions]]` (plural) | **FALSE**. It is `[[events.subscription]]` |
