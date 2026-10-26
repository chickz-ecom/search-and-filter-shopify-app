# Changelog

All notable changes to the storefront SDK (`window.SearchApp`) and the `/v1` API. The format follows [Keep a Changelog](https://keepachangelog.com); versions follow [semver](https://semver.org).

Deprecations are announced here at least 90 days before removal.

## [1.2.0] — 2026-10-26

### Added
- `track()` accepts three more event types for the Analytics pages: `filter_combo` (`{ scope, values }`, two or more `key=value` pairs applied together), `collection_view` (`{ collectionId }`) and `suggestion` (`{ query, suggestion }`, a click on a query suggestion in the search dropdown).
- `track("click", …)` accepts `source` (`"search"`, `"collection"` or `"instant"`) and `collectionId`; `track("filter", …)` accepts `scope` (`"search"` or a collection id). Existing calls keep working; events without these fields are counted without the extra breakdown.
- `/v1/events` accepts the same types.

## [1.1.0] — 2026-10-26

### Added
- Query understanding (opt-in by the merchant under **Search → Understand searches**): words like “red” or “under $50” become filters. `SearchResponse.interpreted` describes the change, and the SDK writes the new query and filters to the URL so shoppers can remove them like any other filter.
- `UrlState.original` (`sa_orig`) and `UrlState.literal` (`sa_literal=1`, search the exact words). The results widget shows a “Search for … instead” link.
- API: `understand=0` and `currency` parameters on `/v1/search`; `interpreted` in the response.
- AI search (Pro plan and above, opt-in): results can also match by meaning. No API change.

## [1.0.0] — 2026-10-26

### Added
- `window.SearchApp` SDK v1: `ready`, `search`, `suggest`, `collection`, `getConfig`, `formatMoney`, `track`, `state`, `on`/`off`, `mount`, `registerWidget`, `render`.
- DOM events `searchapp:ready`, `searchapp:before-search` (cancelable), `searchapp:results`, `searchapp:render`, `searchapp:filters-change`, `searchapp:sort-change`, `searchapp:error`.
- Templates `product-card`, `suggest-item` and `empty`, with a safe template engine (`if`/`unless`/`each`, filters `img_url`, `money`, `upcase`, `downcase`, `truncate`, `default`, `url_encode`, `size`).
- Declarative mounting with `data-searchapp-mount="results"` (alias of `search-page`).
- Market prices: product prices are localized through the Storefront API, with `priceReady: false` when a price can't be confirmed.
- JSON API `/v1/search`, `/v1/collection`, `/v1/suggest`, `/v1/config`, `/v1/events`. Headless access from the Pro plan, opt-in per shop, with optional allowed origins.
