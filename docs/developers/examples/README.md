# Example sections

Three Online Store 2.0 sections (tested with Shopify Theme Check and in a browser against the SDK) that show how to build your own UI on top of the app. Each one is self-contained: Liquid markup, scoped CSS, a small script and a `{% schema %}` with a preset so it appears in the theme editor.

| Section | What it shows |
|---|---|
| [`custom-grid.liquid`](custom-grid.liquid) | Your own product grid with "Load more", rendered with `sdk.search()` and an SDK `<template>`. Tracks clicks. |
| [`horizontal-filters.liquid`](horizontal-filters.liquid) | A filter bar with dropdowns and removable chips, driven by the `results` event and `sdk.state.set()`. |
| [`sort-dropdown.liquid`](sort-dropdown.liquid) | A sort control you can place anywhere. Options come from the merchant's enabled sort options. |

## Install

1. Copy the file to your theme's `sections/` folder (Online Store → Themes → Edit code → Add a new section), or with Shopify CLI.
2. In the theme editor, open the search template (or a collection template) and add the section.
3. Make sure the **Search & Filter** app embed is on.

## Combine them

The sections talk to each other only through the URL state (`sdk.state.set()` → `filters:change` / `sort:change` events), so you can mix them freely:

- **Your own everything:** horizontal filters + sort dropdown + custom grid.
- **Keep the app's grid:** add the app's **Search results** block (or `<div data-searchapp-mount="results" data-filter-position="none" data-show-sort="false"></div>`) and place the horizontal filters and sort dropdown above it. The grid reloads when they change the URL.

## Notes

- Section scripts run before the app embed, which renders at the end of `<body>`. The examples wait for `DOMContentLoaded`, then call `window.SearchApp.ready()`, which loads the SDK on demand.
- SDK templates use `{{ }}` like Liquid. Wrap them in a Liquid `raw` tag, as `custom-grid.liquid` does.
- Prices from the SDK are already in the shopper's currency and market. When `priceReady` is `false`, show "View price" rather than a possibly wrong price.
