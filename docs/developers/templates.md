# Templates

Change the HTML of the built-in widgets without writing JavaScript. Put a `<template>` in your theme:

```liquid
<template data-searchapp="product-card">
  <li class="my-card">
    <a href="{{url}}" data-sa-product="{{id}}" data-sa-pos="{{position}}">
      {{#if image}}<img src="{{image | img_url: 400}}" alt="{{image_alt}}" width="400" height="400" loading="lazy">{{/if}}
      <h3>{{title}}</h3>
      {{#if priceReady}}
        {{#if compare_at_price}}<s>{{compare_at_price}}</s>{{/if}} {{price}}
      {{else}}
        {{view_price}}
      {{/if}}
      {{#each badge_labels}}<span class="badge">{{this}}</span>{{/each}}
    </a>
  </li>
</template>
```

The SDK uses the first match in this order:

1. A `<template data-searchapp="…">` inside the widget's element, then anywhere in the document.
2. The template the merchant saved in the app admin under **Appearance**.
3. The built-in default.

Keep `data-sa-product` and `data-sa-pos` on product links so click analytics keep working.

## Available templates

| Name | Used by | Data |
|---|---|---|
| `product-card` | Results grid | Every [`Product`](sdk-reference.md#product) field, plus `position` (1-based), `badge_labels` (translated badge text) and `view_price` (text shown when the price isn't ready). `vendor` is empty when the merchant hides vendors. |
| `suggest-item` | Instant search dropdown (product rows) | Every `Product` field, plus `position` and `option_id`. Keep `role="option"` and `id="{{option_id}}"` on the root element for keyboard navigation and screen readers. |
| `empty` | No results | `title`, `hint` |

The filter, sort and pagination markup isn't templated in v1. To replace it, build your own controls with the SDK. See the [horizontal filters](examples/horizontal-filters.liquid) and [sort dropdown](examples/sort-dropdown.liquid) examples.

## Syntax

| Syntax | Meaning |
|---|---|
| `{{title}}`, `{{collection.handle}}` | Output a value. Dotted paths read nested fields. All output is HTML-escaped. |
| `{{#if on_sale}}…{{else}}…{{/if}}` | Condition. Empty strings, `0`, `null`, `false` and empty arrays are false. |
| `{{#unless available}}…{{/unless}}` | Negated condition. |
| `{{#each badges}}{{this}} ({{@index}}){{else}}none{{/each}}` | Loop. `this` is the item, `@index` the 0-based index. `{{else}}` renders for an empty list. |
| `{{value \| filter: arg}}` | Apply a filter. Filters can be chained. |

| Filter | Example | Result |
|---|---|---|
| `img_url: width` | `{{image \| img_url: 400}}` | Shopify CDN image URL at that width. |
| `money` | `{{price_min \| money}}` | Minor units formatted with the theme's money format. |
| `upcase`, `downcase` | `{{vendor \| upcase}}` | Changes case. |
| `truncate: n` | `{{title \| truncate: 40}}` | Shortens to `n` characters with `…`. |
| `default: text` | `{{vendor \| default: Unknown}}` | Fallback for empty values. |
| `url_encode` | `{{title \| url_encode}}` | Encodes for URLs. |
| `size` | `{{variants \| size}}` | Length of a list or string. |

The engine never evaluates JavaScript. Templates the merchant saves in the admin are also rejected if they contain `<script>`, `<iframe>`, `on…=` handlers or `javascript:` URLs.
