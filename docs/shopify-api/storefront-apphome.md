# Storefront API (2026-10) + App Home (Polaris 2.x / App Bridge): verified notes

Verified 2026-10-26 with the Shopify Dev MCP (`learn_shopify_api`, `search_docs_chunks`, `validate`), the installed type packages (`@shopify/polaris-types@2.0.0`, `@shopify/app-bridge-types@0.7.3`, `@shopify/app-bridge-react@4.2.14`, `@shopify/shopify-app-react-router@4.0.0`), and a few tokenless calls to mock.shop.

Labels used below:
- **VERIFIED**: confirmed by an MCP doc quote, the `validate` tool, or the installed `.d.ts` / custom-elements manifest.
- **UNVERIFIED**: no doc or type confirms it. Treat it as an assumption.
- **NOT FOUND**: searched for and not present.

Validated operations are in `docs/shopify-api/storefront/`:

| File | Status |
|---|---|
| `product-prices.graphql` | VALID against storefront-graphql 2026-10 |
| `variant-prices.graphql` | VALID |
| `best-selling-ids.graphql` | VALID |
| `predictive-search.graphql` | VALID |
| `search-products.graphql` | VALID |

The validator does catch bad fields. A negative test with `fooBar` on `Product` failed as expected.

---

## 1. Batched product prices with `nodes` + `@inContext`

The query in the brief is **VALID as written** against 2026-10. The only change was renaming the operation to `ProductPrices`. Nullable `$country`/`$language` variables are accepted by `@inContext`.

```graphql
query ProductPrices($ids: [ID!]!, $country: CountryCode, $language: LanguageCode)
@inContext(country: $country, language: $language) {
  nodes(ids: $ids) {
    ... on Product {
      id
      availableForSale
      priceRange {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
      compareAtPriceRange { maxVariantPrice { amount currencyCode } }
    }
  }
}
```

- **Max ids: 250 (VERIFIED).** "The input accepts up to 250 IDs… The input must not contain more than 250 values." Return type is `[Node]!`, so each item is nullable. Source: https://shopify.dev/docs/api/storefront/2026-10/queries/nodes
- **Not published to the buyer's market means `null` (VERIFIED for `product`, inferred for `nodes`).** The docs say: "Unpublished products will behave just like they were archived or deleted: they will be omitted from connections and not found when queried by handle or ID. Use the `@inContext` directive to set the context explicitly; if omitted, the primary market will be used." The doc example shows `alarmClock: null` for a product unpublished in GB. Source: https://shopify.dev/docs/api/storefront/2026-04/queries/product (the same text appears on the product reference page in every version).
  - Map the results by `id`, never by array index. Expect `null` entries for ids that are deleted, unpublished or out of market.
  - Sales-channel caveat (VERIFIED): if the app is itself a sales channel, products must be published to that channel **and** to the market.
  - UNVERIFIED: which publication tokenless or online-store-origin requests check. It is presumably the Online Store channel.
- **Tokenless access (VERIFIED).**
  - Tokenless access works with **no auth header at all**. The docs' tokenless cURL sends only `Content-Type: application/json`.
  - Tokenless covers: Products and Collections, Selling Plans, Search, Pages/Blogs/Articles, and Cart (read/write).
  - These need a token: Product Tags, Metaobjects and Metafields, Menu, and Customers.
  - Tokenless has a query complexity limit of **1,000**, calculated "the same way as the GraphQL Admin API". Going over returns `{"errors":[{"message":"Complexity exceeded","extensions":{"code":"MAX_COMPLEXITY_EXCEEDED","cost":1250,"maxCost":1000}}]}`.
  - Sources: https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api and https://shopify.dev/docs/api/storefront/2026-10 (Rate limits section).
- **Endpoint.**
  - VERIFIED form: `https://<store>.myshopify.com/api/<version>/graphql.json`, POST only. This comes from the storefront-graphql `learn_shopify_api` instructions.
  - **UNVERIFIED / NOT FOUND:** same-origin `/api/2026-10/graphql.json` on the shop's custom (online store) domain. No doc returned by the MCP mentions it. For theme or app-embed JS, the safe option is the documented `https://{{ shop.permanent_domain }}/api/2026-10/graphql.json`. Test same-origin and CORS on a dev store before relying on them.
- **Query cost for 48 ids.** The docs only define defaults: Scalar/Enum 0, Object 1, Interface = maximum of the possible selections, Connection sized by `first`/`last`. There is no documented rule for a list field sized by an input array.
  - Per `Product` fragment: Product 1 + priceRange 1 + min 1 + max 1 + compareAtPriceRange 1 + max 1 = **6**.
  - Observed on mock.shop (a Shopify-run tokenless Storefront, but **not authoritative**): `requestedQueryCost: 6` for 48, 160 and 250 ids. The `nodes` list is not multiplied by the number of ids.
  - Worst-case assumption if a real shop does multiply: 48 × 6 = **288** (OK). 250 × 6 = 1,500 would exceed the tokenless limit. To stay inside 1,000 even under that assumption, keep tokenless batches at **160 ids or fewer** or check against a dev store.
  - UNVERIFIED that `Shopify-GraphQL-Cost-Debug: 1` (documented for Admin) returns a breakdown on Storefront.

## 2. Quick-view variant prices: VALID

```graphql
query VariantPrices($id: ID!, $country: CountryCode, $language: LanguageCode)
@inContext(country: $country, language: $language) {
  node(id: $id) {
    ... on Product {
      id
      variants(first: 100) {
        nodes {
          id
          availableForSale
          price { amount currencyCode }
          compareAtPrice { amount currencyCode }
        }
      }
    }
  }
}
```

- Cost on mock.shop: `requestedQueryCost: 301` (1 + 100 × 3), under the 1,000 tokenless limit. Not authoritative, but it matches the connection rule.
- `variants(first: 250)` would be roughly 751 and still under the limit (UNVERIFIED).

## 3. Server-side best-selling order: VALID

```graphql
query BestSellingProductIds($cursor: String) {
  products(first: 250, after: $cursor, sortKey: BEST_SELLING) {
    nodes { id }
    pageInfo { hasNextPage endCursor }
  }
}
```

- mock.shop reported `requestedQueryCost: 500` for this query (not authoritative).
- **Headers (VERIFIED)**, from https://shopify.dev/docs/api/storefront/2026-10 (Authentication):
  - **Public** token: `X-Shopify-Storefront-Access-Token`. "Create a public access token with the `storefrontAccessTokenCreate` mutation on the GraphQL Admin API. Then send it in the X-Shopify-Storefront-Access-Token header." The Admin `StorefrontAccessToken.accessToken` field is described as "The issued **public** access token". So a token from `storefrontAccessTokenCreate` is public, not private.
  - **Private** token: `Shopify-Storefront-Private-Token`, plus `Shopify-Storefront-Buyer-IP` (case-sensitive) when the request comes from buyer traffic. Batch jobs that aren't tied to a buyer (the docs' example is a static site build) don't need the Buyer-IP header.
  - Ways to get a private token: the Headless channel, a delegate access token, or "Request unauthenticated access scopes on an existing access token".
  - Limit: 100 active storefront access tokens per shop.
- **Template path (VERIFIED in installed code).** `unauthenticated.storefront(shop)` from `@shopify/shopify-app-react-router` uses the shop's **offline Admin session token** as `privateAccessToken`, which is sent as the `Shopify-Storefront-Private-Token` header (`node_modules/@shopify/shopify-api/dist/esm/lib/clients/storefront/client.mjs`).
  - This requires `unauthenticated_*` scopes. `unauthenticated_read_product_listings` covers Product/Collection (https://shopify.dev/docs/api/usage/access-scopes).
  - **The current `shopify.app.toml` only has `scopes = "write_products"`.** Add `unauthenticated_read_product_listings` before using this path.
- **Server and automated traffic guidance (VERIFIED).**
  - "The Storefront API scales with buyer traffic: requests from real buyers aren't subject to a fixed request-per-minute limit. Automated traffic and checkout creation are limited… Bots and crawlers are limited, most strictly when unsigned. Sign with Web Bot Auth for higher limits."
  - "Public access capacity scales with the number of buyers, based on their IP address."
  - Without `Shopify-Storefront-Buyer-IP`, "Shopify can't differentiate requests from different buyers, which can result in throttled API requests".
  - Malicious-looking requests get HTTP **430**.
  - Takeaway: don't run a server crawl tokenless or with a public token from one IP. Use a private token for the best-selling sync, and keep it slow, with backoff.

## 4. `predictiveSearch` / `search`: both EXIST (validated)

- `predictiveSearch(query:, limit:, limitScope: EACH, types: [PRODUCT, COLLECTION, QUERY])` returns `products`, `collections`, `queries { text styledText }`.
- `search(query:, first:, after:, types: [PRODUCT], sortKey: RELEVANCE, unavailableProducts: LAST)` returns `totalCount`, `nodes`, `pageInfo`.
- Both work tokenless, since Search is in the tokenless list. See `predictive-search.graphql` and `search-products.graphql`.

---

## App Home: version facts (critical)

- **Polaris 2.0 went stable on 2026-10-22.** Source: https://shopify.dev/changelog/posts/polaris-cdn-2-0-is-now-stable
  - `polaris.js` and `polaris-1.js` stay on 1.1. `polaris-2.js` is the stable 2.x channel, and `polaris-2.0.js` pins exactly 2.0.
  - The installed `@shopify/shopify-app-react-router@4.0.0` already **defaults `polarisUrl` to `https://cdn.shopify.com/shopifycloud/polaris-2.js`** (`AppProvider` and the server config; VERIFIED in `dist`). Load exactly one Polaris script, after `app-bridge.js`.
- The MCP `learn_shopify_api` defaults polaris-app-home to **v1.1**. Validation here was run with `version: "v2.0"`, which is accepted. App Home docs exist at `/docs/api/app-home/v2.0/...`.
- **React 18 caveat (VERIFIED in the docs).**
  - From https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react: "If the app renders Polaris web components through React, upgrade to React 19 before migrating controlled fields. React 18 doesn't provide the custom-element property and event behavior that controlled Polaris web components rely on." The same warning appears on the form and checkbox migration pages.
  - **This repo uses `react@18.3.1`.**
  - On React 18, prefer uncontrolled, named fields inside a native `<form>` and read values with `FormData`. `onClick` works because click bubbles.
  - For `input`/`change`, attach listeners through a `ref` and `addEventListener` (UNVERIFIED that the React 18 `onChange` prop fires on `s-*`; assume it doesn't).
  - React 18 also drops `defaultValue`/`defaultChecked` on custom elements (React-internal reserved props). Use the HTML attributes instead: `value="…"` maps to `defaultValue` and `checked` maps to `defaultChecked`, per the custom-elements manifest. Note also that `checked={false}` becomes `checked="false"`, which counts as checked; use `checked={x || undefined}`. These are React 18 behaviors, not Shopify docs, so check them in a browser.

## 5. Component inventory (Polaris 2.0)

Source: `@shopify/polaris-types@2.0.0` (`dist/polaris.d.ts` + `custom-elements.json`), plus `validate` (v2.0) on a smoke page with 32 components, which was VALID. Polaris components are global (no imports), and props are camelCase. Field components share `onInput` (every change), `onChange` (committed: blur/Enter, or immediately for toggles), `onFocus` and `onBlur`; read `e.currentTarget.value`. Docs: https://shopify.dev/docs/api/polaris/using-polaris-web-components

| Component | Status | Key props / slots / events |
|---|---|---|
| `s-page` | EXISTS | `heading`, `inlineSize` (`small`/`base`/`large`). Slots: `primary-action` (one primary `s-button`), `secondary-actions` (buttons/button-group), `breadcrumb-actions` (`s-link`), `aside` (only when `inlineSize="base"`), `supplemental-start` (for example a banner). App Bridge also documents `slot="accessory"` for an `s-badge`. |
| `s-section` | EXISTS | `heading`, `subheading`, `padding` (`base`/`none`), `accessibilityLabel`. Slots: `primary-action`, `secondary-actions`, `graphic`, `accessory`, `supplemental` |
| `s-stack` | EXISTS | `direction` (`block`/`inline`), `gap`, `rowGap`, `columnGap`, `alignItems`, `justifyContent`, plus box props |
| `s-grid` (+ `s-grid-item`) | EXISTS | `gridTemplateColumns`, `gap`, align/justify/place props. Item: `gridColumn`, `gridRow` |
| `s-box` | EXISTS | `padding*`, `background`, `border*`, `borderRadius`, sizes, `display`, `overflow`, `accessibilityRole` |
| `s-button` | EXISTS | `variant` (`auto`/`primary`/`secondary`/`tertiary`), `tone` (`auto`/`neutral`/`critical`), `href`, `target`, `download`, `type` (`button`/`submit`/`reset`), `loading`, `disabled`, `icon`, `inlineSize`, `commandFor`, `command` (`--auto`/`--show`/`--hide`/`--toggle`/`--copy`), `interestFor`, `accessibilityLabel`. Events: `onClick`/`onFocus`/`onBlur` |
| `s-button-group` | EXISTS | `gap`. Slots: `primary-action`, `secondary-actions` |
| `s-link` | EXISTS | `href`, `target`, `tone`, `download`, `command`/`commandFor`, `onClick`. **No `rel` in the types** (see `s-app-nav`). |
| `s-text` | EXISTS | `type` (`strong`/`address`/`redundant`/`generic`), `tone`, `color`, `fontSize`, `fontWeight`, `interestFor` |
| `s-heading` | EXISTS | `fontSize`, `lineClamp`, `accessibilityRole` |
| `s-paragraph` | EXISTS | `tone`, `color`, `fontSize`, `fontWeight`, `lineClamp` |
| `s-badge` | EXISTS | `tone`, `color`, `icon`, `size` |
| `s-banner` | EXISTS | `heading`, `tone` (`auto`/`info`/`success`/`warning`/`critical`), `dismissible`, `hidden`. Slot `secondary-actions`. Events `onDismiss`, `onAfterHide` |
| `s-text-field` | EXISTS | `label`, `name`, `value`/`defaultValue`, `placeholder`, `required`, `readOnly`, `icon`, `prefix`, `suffix`, `minLength`/`maxLength`, `error`, `details`, `labelAccessibilityVisibility`. Slot `accessory`. Field events |
| `s-number-field` | **EXISTS** | `min`, `max`, `step`, `inputMode` (`decimal`/`numeric`), `prefix`, `suffix`, `value`/`defaultValue` (**string**), plus the field props and events |
| `s-select` + `s-option` (+ `s-option-group`) | EXISTS | Select: `label`, `name`, `value`, `placeholder`, `icon`, `required`, `disabled`, `onChange`/`onInput`. Option: `value`, `selected`, `disabled` |
| `s-checkbox` | EXISTS | `checked`/`defaultChecked`, `indeterminate`, `value`, `name`, `label`, `error`, `details`. `onChange`/`onInput` |
| `s-switch` | **EXISTS** | `checked`/`defaultChecked`, `value` (sent in form data when checked), `name`, `label`, `labelAccessibilityVisibility`, `disabled`, `required`. `onChange`/`onInput`/`onBlur` |
| `s-choice-list` + `s-choice` | EXISTS | List: `label`, `name`, `multiple`, `values` (string[]), `disabled`, `error`, `details`. `onChange`/`onInput` (read `currentTarget.values`). Choice: `value`, `selected`, `disabled`. Slots `details`, `secondary-content` |
| `s-table` + `s-table-header-row`, `s-table-header`, `s-table-body`, `s-table-row`, `s-table-cell` | **EXISTS** | Table: `variant` (`auto`/`list`), `loading`, `paginate`, `hasPreviousPage`, `hasNextPage`, `onNextPage`/`onPreviousPage`, slot `filters`. Header: `listSlot` (`primary`/`secondary`/`inline`/`kicker`/`labeled`), `format` (`base`/`numeric`/`currency`). Row: `clickDelegate` |
| `s-modal` | EXISTS | `id`, `heading`, `size`, `padding`, `accessibilityLabel`. Slots `primary-action`, `secondary-actions`. Events `onShow`/`onHide`/`onAfterShow`/`onAfterHide`. Methods `showOverlay()`/`hideOverlay()`/`toggleOverlay()`. Open with `<s-button command="--show" commandFor="id">` |
| `s-app-window` | **EXISTS, in App Bridge, not Polaris** | Typed in `@shopify/app-bridge-types` (`SAppWindowAttributes`: `id`, `src` required). Methods `show()`/`hide()`/`toggle()`. Supports `command`/`commandFor`. Fullscreen; loads `src` in an iframe. https://shopify.dev/docs/api/app-home/v2.0/app-bridge-web-components/app-window |
| `s-popover` | EXISTS | `id`, size props. Events `onShow`/`onHide`/`onToggle`/`onAfter*`. Trigger with `commandFor` |
| `s-spinner` | EXISTS | `size` (`base`/`large`/`large-100`), `accessibilityLabel` |
| `s-empty-state` | **EXISTS** (2.0, and also passes in v1.1) | `heading`. Slots `primary-action`, `secondary-actions`, `graphic`, `subheading` |
| `s-progress` | **EXISTS** (2.0, and also passes in v1.1) | `value`, `max`, `tone`, `accessibilityLabel` |
| `s-divider` | EXISTS | `direction`, `color` |
| `s-icon` | EXISTS | `type` (icon name), `tone`, `color`, `size` (`base`/`small`), `interestFor` |
| `s-thumbnail` | EXISTS | `src`, `alt`, `size`, `loading`. `onLoad`/`onError` |
| `s-clickable` | EXISTS | `href`, `target`, `command`/`commandFor`, `loading`, `disabled`, box props. `onClick` |
| `s-drop-zone` | EXISTS | `label`, `name`, `accept`, `multiple`, `disabled`, `files` (readonly). `onChange`/`onInput`/`onDropRejected` |
| `s-color-field` / `s-color-picker` | EXISTS / EXISTS | `value`, `alpha`, `name` (+ `label` and field props on the field). `onInput`/`onChange` |
| `s-search-field` | EXISTS | Text-field props, minus icon/prefix/suffix. Field events |
| `s-date-picker` (+ `s-date-field`) | EXISTS | `type` (`single`/`range`), `value`, `allow`/`disallow`, `allowDays`/`disallowDays`, `view`, `visibleMonths`. `onChange`/`onInput`/`onViewChange` |
| `s-app-nav` + `s-link` children | **EXISTS, in App Bridge, not Polaris** | `SAppNavLinkAttributes`: `href`, `rel?: "home"`. Docs: the app name already links to `/`. If home is elsewhere (for example `/app`), add `s-link rel="home"`. **Type gap:** Polaris `s-link` types reject `rel`, so `validate` failed with `rel` and passed without it. Use a cast or spread for `rel="home"`. |
| `s-query-container` | EXISTS | `containerName` |
| `s-menu` | **EXISTS** | `id`, `accessibilityLabel`. Children are `s-button`s. Opened by `<s-button commandFor="menu-id">` |
| Also in 2.0 | EXISTS | `s-avatar`, `s-chip`, `s-clickable-chip`, `s-date-field`, `s-email-field`, `s-image`, `s-money-field`, `s-number` (inline numeric text), `s-password-field`, `s-press-button` (`pressed`), `s-scroll-box`, `s-text-area`, `s-tooltip`, `s-url-field`, `s-ordered-list`/`s-unordered-list`/`s-list-item` |
| `s-form`, `s-card` | NOT FOUND (App Home iframe) | Use a native `<form>`. `s-form` exists only for the App Home UI *extension* target. |

## 6. Contextual Save Bar

**Declarative form (VERIFIED; App Home v2.0 docs):** https://shopify.dev/docs/api/app-home/v2.0/app-bridge-web-components/save-bar

```html
<form data-save-bar data-discard-confirmation onsubmit="…" onreset="…">
  <s-text-field label="Title" name="title"></s-text-field>
</form>
```

- `data-save-bar`: "the save bar appears whenever any form input value changes from its initial state… automatically hides when the form is submitted or reset."
- `data-discard-confirmation` shows a confirmation dialog on Discard.
- Save triggers the `submit` event (`SubmitEvent`). Discard triggers the `reset` event. Both can be cancelled with `preventDefault()`.

**Programmatic (VERIFIED):** https://shopify.dev/docs/api/app-home/v2.0/apis/user-interface-and-interactions/save-bar-api

```tsx
<ui-save-bar id="settings-save-bar">
  <button variant="primary" onClick={handleSave}>Save</button>
  <button onClick={handleDiscard}>Discard</button>
</ui-save-bar>
// shopify.saveBar.show(id) / hide(id) / toggle(id)  -> Promise<void>
// shopify.saveBar.leaveConfirmation()  -> Promise<void> (call before programmatic navigation)
```

- The `ui-save-bar` element also has a `discardConfirmation` property, a read-only `showing` getter, `show()`/`hide()`/`toggle()` methods, and `show`/`hide` events (app-bridge-types).

**Which to use (VERIFIED guidance, migrate-contextual-save-bar):**
- Use `data-save-bar` for a standard form of native or `s-*` named fields.
- Use `<ui-save-bar>` when dirty state comes from several sources or isn't held in native form controls. That includes React-controlled values changed without a native `input`/`change` event, which `data-save-bar` can't see.
- **Don't combine the two on the same form or page.**
- On save failure, "Keep the save bar active… Don't clear dirty state or hide a programmatic save bar until the backend confirms success."
- Neither approach is labeled "recommended for 2026". `data-save-bar` is presented as the default for standard forms.

**React Router (`useFetcher` / `<Form>`):**
- React Router's `<Form>`/`fetcher.Form` render a native `<form>`. `data-*` attributes and `onReset` pass through, and the native `submit` event still fires, so the save bar hides on submit.
- Native `<form onSubmit={e => { e.preventDefault(); fetcher.submit(e.currentTarget, {method: "post"}) }}>` was validated in §9.
- UNVERIFIED: whether App Bridge resets its "initial state" baseline after a fetcher submit without navigation, and how it behaves if the action returns an error. The auto-hide happens on submit, before the server answers. Use the programmatic API if save failures must keep the bar visible.

## 7. `shopify.app.extensions()` (VERIFIED)

Sources: https://shopify.dev/docs/api/app-home/v2.0/apis/authentication-and-data/app-api and https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/migrate. Types are in `@shopify/app-bridge-types/dist/index.d.ts` (`AppApi`, `ExtensionInfo`).

```ts
shopify.app.extensions(): Promise<ExtensionInfo[]>   // may be [], throws if unavailable
ExtensionInfo { handle: string; type: "ui_extension" | "theme_app_extension"; activations: … }
// ui_extension       -> activations: { target: string }[]
// theme_app_extension-> activations: ThemeExtensionActivation[]
ThemeExtensionActivation {
  handle: string;            // block/embed Liquid filename (no extension)
  name: string;              // schema name
  target: "section" | "head" | "body" | "compliance_head";  // section = app block, head/body = app embed
  status: "active" | "available" | "unavailable";
  activations: { target: string; themeId: string }[];       // placements, e.g. "template--product.alternate/main/<block>_GPzUYy", themeId "gid://shopify/OnlineStoreTheme/…"
}
```

- **App embed enabled:** a `theme_app_extension` activation with `handle === '<embed file>'` and `status === 'active'`. `available` means the app ships it but the merchant hasn't enabled it.
- **App blocks added:** a `target === 'section'` entry whose nested `activations[]` is non-empty, which gives the templates and placements.
- The data covers **the published theme only**. No access scopes are needed. It only answers while the merchant has the app open, so record the result if needed later. For a backend check, read `config/settings_data.json` (needs `read_themes`).
- TS note: `activations` is a conditional type that doesn't narrow on `ext.type`. Cast it, as in §9.

## 8. Other App Bridge APIs (VERIFIED from `app-bridge-types@0.7.3`, v2.0 docs)

- **`shopify.resourcePicker`** (https://shopify.dev/docs/api/app-home/v2.0/apis/user-interface-and-interactions/resource-picker-api):
  - Options: `{type: 'product'|'variant'|'collection', action?: 'add'|'select', multiple?: boolean|number, query?, filter?, selectionIds?: {id}[]}`.
  - Returns `Promise<Collection[] | undefined>`; `undefined` means cancelled.
  - `Collection` fields: `id` (Admin GID), `title`, `handle`, `description`, `descriptionHtml`, `image?`, `productsCount`, `productsAutomaticallySortedCount`, `productsManuallySortedCount`, `publicationCount`, `availablePublicationCount`, `ruleSet?`, `seo`, `sortOrder`, `storefrontId`, `templateSuffix?`, `updatedAt`.
  - The `.selection` alias is deprecated.
- **`shopify.toast.show(message, {duration?=5000, isError?, action?, onAction?}) => string`** (toast id). `shopify.toast.hide(id)`. Source: https://shopify.dev/docs/api/app-home/v2.0/apis/user-interface-and-interactions/toast-api
- **`shopify.webVitals.onReport(cb | null) => Promise<void>`** (https://shopify.dev/docs/api/app-home/v2.0/apis/device-and-platform-integration/web-vitals-api):
  - Payload: `{ metrics: { id: string; name: 'LCP'|'FCP'|'CLS'|'INP'|'TTFB'|'FID' (string); value: number; country?: string; version?: string }[] }`.
- **`shopify.idToken(): Promise<string>`** (JWT). App Bridge's fetch interceptor already adds it as `Authorization` on requests to the app's own domain. Call it directly only for things like WebSockets, and send it only to your own backend. Source: https://shopify.dev/docs/api/app-home/v2.0/apis/authentication-and-data/id-token-api
- **`shopify.intents`** (https://shopify.dev/docs/api/app-home/v1.1/apis/user-interface-and-interactions/intents-api; App Bridge isn't versioned with Polaris):
  - `invoke?('edit:shopify/Collection,gid://…')` or `invoke?({action: 'create'|'edit'|'pick', type: 'shopify/Collection'|…, value?, data?})` returns `Promise<{complete?: Promise<{code?: 'ok', data?}|{code?: 'closed'}|{code?: 'error', message?, issues?}>}>`.
  - Also `request` (the current intent, or `null`), `response?`, and `register(cb)`.
- Also present: `shopify.loading(bool)`, `shopify.modal`, `shopify.picker`, `shopify.scopes`, `shopify.support.registerHandler`, `shopify.reviews`, `shopify.user()`, `shopify.environment`.

## 9. Validated sample page (polaris-app-home v2.0: VALID)

The validator's `useAppBridge()` typing is App Bridge 3 (`ClientApplication`), which caused false errors on `.app` and `.toast`. The installed `@shopify/app-bridge-react@4.2.14` does return `ShopifyGlobal`. The sample therefore uses the global `shopify`, as Shopify's own examples do. It uses `defaultValue`/`defaultChecked`, so it needs React 19 (see the React 18 caveat above).

```tsx
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";

type Facet = { id: string; label: string; enabled: boolean };
type LoaderData = { facets: Facet[]; perPage: number };
type ActionData = { ok: boolean; error?: string };
// Mirrors ThemeExtensionActivation in @shopify/app-bridge-types (not exported by name)
type ThemeBlockActivation = {
  handle: string;
  name: string;
  target: "section" | "head" | "body" | "compliance_head";
  status: "active" | "available" | "unavailable";
  activations: { target: string; themeId: string }[];
};

export default function SettingsPage() {
  const { facets, perPage } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>();
  const [embedEnabled, setEmbedEnabled] = useState<boolean | null>(null);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    shopify.app
      .extensions()
      .then((extensions) => {
        const enabled = extensions
          .filter((ext) => ext.type === "theme_app_extension")
          .some((ext) =>
            (ext.activations as ThemeBlockActivation[]).some(
              (block) => block.handle === "search-embed" && block.status === "active",
            ),
          );
        setEmbedEnabled(enabled);
      })
      .catch(() => setEmbedEnabled(null));
  }, []);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <s-page heading="Search settings" inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">Home</s-link>
      <s-button slot="secondary-actions" href="/app/analytics">View analytics</s-button>

      {embedEnabled === false && (
        <s-banner slot="supplemental-start" tone="warning" heading="App embed is off">
          <s-paragraph>Turn on the search app embed in the theme editor.</s-paragraph>
        </s-banner>
      )}

      <form
        data-save-bar
        data-discard-confirmation
        onSubmit={(event) => {
          event.preventDefault();
          fetcher.submit(event.currentTarget, { method: "post" });
        }}
        onReset={() => {
          // Uncontrolled named fields reset natively; reset app-owned state here.
        }}
      >
        <s-section heading="Results">
          <s-stack direction="block" gap="base">
            <s-number-field
              label="Products per page"
              name="perPage"
              defaultValue={String(perPage)}
              min={12}
              max={96}
              step={12}
              inputMode="numeric"
              details="Between 12 and 96"
            />
            <s-switch label="Show sold-out products" name="showSoldOut" value="on" />
          </s-stack>
        </s-section>

        <s-section heading="Filters" padding="none">
          <s-table variant="auto" loading={saving}>
            <s-table-header-row>
              <s-table-header listSlot="primary">Filter</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="labeled">Enabled</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {facets.map((facet) => (
                <s-table-row key={facet.id}>
                  <s-table-cell><s-text type="strong">{facet.label}</s-text></s-table-cell>
                  <s-table-cell>
                    <s-badge tone={facet.enabled ? "success" : "neutral"}>
                      {facet.enabled ? "Active" : "Hidden"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-switch
                      label={`Enable ${facet.label}`}
                      labelAccessibilityVisibility="exclusive"
                      name={`facet:${facet.id}`}
                      value="on"
                      defaultChecked={facet.enabled}
                    />
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>

        {fetcher.data?.error && (
          <s-banner tone="critical" heading="Could not save">{fetcher.data.error}</s-banner>
        )}
      </form>
    </s-page>
  );
}
```

Validation history:
1. `useAppBridge()` failed with validator false positives.
2. `ext.activations.some(b => b.status…)` failed: `handle`/`status` don't exist on `UiExtensionActivation`. Fixed with the cast.
3. Final run: VALID. Components found: s-page, s-link, s-button, s-banner, s-paragraph, s-section, s-stack, s-number-field, s-switch, s-table, s-table-header-row, s-table-header, s-table-body, s-table-row, s-table-cell, s-text, s-badge. The native `form` isn't validated, which is expected.

On React 18, swap `defaultValue={…}` for `value={…}` and `defaultChecked={x}` for `checked={x || undefined}` (attribute semantics). Check in a browser; this is UNVERIFIED by Shopify docs.
