# Developer docs

Build custom search and collection experiences on top of the app: change the markup of the built-in widgets, write your own Liquid sections, or call the search API from a headless storefront. You always get the merchant's relevance settings, synonyms, merchandising rules, filters and market prices.

| Guide | Use it to |
|---|---|
| [Quickstart](quickstart.md) | Pick an integration level and get results on the page in a few minutes. |
| [SDK reference](sdk-reference.md) | Look up every method and type of `window.SearchApp` (generated from the published `.d.ts`). |
| [Events](events.md) | React to searches, results and filter changes from your own scripts. |
| [Templates](templates.md) | Change the HTML of product cards, instant search items and the empty state. |
| [Headless API](headless.md) | Call the JSON API from outside the Online Store theme. |
| [OpenAPI spec](openapi.yaml) | Generate a client or explore the API in your tool of choice. |
| [Example sections](examples/) | Copy working sections: custom grid, horizontal filters, custom sort dropdown. |
| [Changelog](CHANGELOG.md) | See what changed in each SDK and API version. |

## Compatibility promise

- The SDK (`window.SearchApp`) and the `/v1` API follow [semantic versioning](https://semver.org). Breaking changes ship only in a new major version (`window.SearchApp` v2, `/v2`).
- Anything we plan to remove is marked deprecated in the changelog and the SDK reference **at least 90 days** before it's removed.
- New optional fields can appear in responses at any time. Ignore fields you don't recognise.
- CI checks the published type definitions against a snapshot, so a breaking change can't ship by accident.

## Where to find your keys

In the Shopify admin, open the app and go to **Developers**. You'll find the shop domain, the public key, the API endpoint and the headless access switch. The public key is safe to use in storefront code.
