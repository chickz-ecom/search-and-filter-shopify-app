# Events

The SDK emits events in two ways. Use whichever suits your code:

```js
// 1. SDK subscription (returns an unsubscribe function)
const off = window.SearchApp.on("results", (res) => console.log(res.total));

// 2. DOM events on document — no need to wait for the SDK
document.addEventListener("searchapp:results", (e) => console.log(e.detail.total));
```

DOM event names are `searchapp:` plus the event name, with `:` replaced by `-`.

| Event | DOM event | `payload` / `detail` | Cancelable |
|---|---|---|---|
| `ready` | `searchapp:ready` | The SDK object | No |
| `before-search` | `searchapp:before-search` | `{ params }` — the `SearchParams` about to be sent. Change them in place. | Yes |
| `results` | `searchapp:results` | `SearchResponse` | No |
| `render` | `searchapp:render` | `{ type, el }` — a widget is about to mount into `el` | No |
| `filters:change` | `searchapp:filters-change` | `Filters` — the new selection, after the URL is updated | No |
| `sort:change` | `searchapp:sort-change` | The new sort key | No |
| `error` | `searchapp:error` | The error. The default widgets keep Shopify's native results on screen. | No |

## Change a search before it's sent

`before-search` lets you adjust parameters, for example to always exclude a vendor on one page:

```js
document.addEventListener("searchapp:before-search", (e) => {
  e.detail.params.filters = { ...e.detail.params.filters, availability: true };
});
```

Call `e.preventDefault()` to cancel the search. The SDK call then rejects with `Error("search cancelled")`.
