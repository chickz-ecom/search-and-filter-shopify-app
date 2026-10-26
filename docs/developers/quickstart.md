# Quickstart

There are four ways to integrate, from no code to fully custom. You can mix them.

## 1. App blocks (no code)

1. In the theme editor, turn on the **Search & Filter** app embed (Theme settings → App embeds).
2. On the search template, add the **Search results** block. On collection templates, add the **Collection filters** block.
3. Configure columns, products per page, filter position and sort in the block settings.

The blocks render Shopify's native results first (SEO and fallback), then the app takes over in place.

## 2. Declarative mount in your own section

Put this in any section. The app embed loads the results widget when it finds `data-searchapp-mount`:

```liquid
<div
  data-searchapp-mount="results"
  data-per-page="24"
  data-columns="3"
  data-filter-position="top"
  {% if collection %}data-mode="collection" data-collection="{{ collection.handle }}"{% endif %}
></div>
```

| Attribute | Values | Default |
|---|---|---|
| `data-searchapp-mount` | `results` (alias of `search-page`), or a type you registered | — |
| `data-per-page` | 1–48 | `24` |
| `data-columns` | Number of columns on desktop | `4` |
| `data-filter-position` | `left`, `top`, `drawer`, `none` (build your own filters with the SDK) | `left` |
| `data-show-sort` | `true`, `false` | `true` |
| `data-mode` + `data-collection` | `collection` + a collection handle | search page |

Add a `<template data-searchapp="product-card">` inside the same element to change the card markup. See [Templates](templates.md).

## 3. JavaScript SDK

`window.SearchApp` is available on every page once the app embed is on. The embed renders at the end of `<body>`, after your sections, so wait for `DOMContentLoaded` before using it. `ready()` loads the SDK on demand and resolves when it's available.

```html
<script>
  document.addEventListener("DOMContentLoaded", () => window.SearchApp?.ready().then(async (sdk) => {
    const res = await sdk.search({
      q: "dress",
      filters: { vendor: ["Nike"], price: { min: 10, max: 50 } },
      sort: "price_asc",
      perPage: 24,
    });
    console.log(res.total, res.products.map((p) => `${p.title} ${p.price}`));
  }));
</script>
```

- Prices in `res.products[].price` are already formatted in the shopper's currency and market. When the correct price can't be confirmed, `price` is `null` and `priceReady` is `false`. Show a "View price" link instead of a wrong price.
- Filter ids and sort keys come from `await sdk.getConfig()`, which reflects what the merchant configured in the admin.
- If `res.redirect` is set, the merchant configured a redirect for that search. Navigate there.
- `sdk.state.get()` / `sdk.state.set()` keep the search in the URL using Shopify's native parameters (`filter.p.vendor`, `filter.v.price.gte`, `sort_by`, `page`), so links and the back button work.

Full API: [SDK reference](sdk-reference.md). Ready-made sections: [examples](examples/).

## 4. Headless

Call `GET https://<endpoint>/v1/search?shop=<shop>.myshopify.com&key=<public key>&q=dress` from your own storefront or app. Headless access is available from the Pro plan and the merchant turns it on in **Developers**. See [Headless API](headless.md).
