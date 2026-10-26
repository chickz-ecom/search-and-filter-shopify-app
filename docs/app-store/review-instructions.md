# App review instructions

Written for: Shopify App Review. Paste the "Testing instructions" section into the submission form.

## Testing instructions

1. Install the app on the review store. Install is managed by Shopify, so there is no separate login or sign-up.
2. **Home** shows a setup guide. Select **Turn on the app embed**: the theme editor opens on App embeds. Switch on **Search & Filter** and save. Back in the app, Home shows the embed as on.
3. On Home, select **Add results to the search page**: the theme editor adds the **Search results** block to the search template. Save.
4. Open the storefront and type "shirt" in the search box: instant results appear, and you can navigate them with the keyboard. Press Enter: the search page shows filters (price, brand) and a sort menu. Filter and sort changes update the URL using Shopify's own filter parameters.
5. In the app, open **Search**, raise the weight of "Vendor", then use **Try a search** on the right: the ranking changes before you save. Select **Save** in the contextual save bar.
6. Open **Merchandising → Redirects**, add "shipping" → `/policies/shipping-policy`, then search "shipping" on the storefront: you are redirected.
7. Open **Appearance**, change the accent color: the preview next to the editor updates. Save, and the storefront updates within a minute.
8. **Plans** opens Shopify's plan selection page. The free plan covers stores under 100 products.

The catalog sync starts automatically at install. The **Sync** page shows progress, and a small store finishes in under a minute.

## Notes for reviewers

- **Storefront:** only a theme app extension (app embed and two app blocks) and a web pixel. No ScriptTag, no Asset API writes, and no theme code is changed.
- **Lighthouse:** on a reference theme, the weighted score drops by 0.4 points (target ≤ 5). Nothing loads on pages without search until the shopper focuses the search box.
- **Security:** `shopify app security check` passes all 35 agent checks. One deterministic `UNSAFE_INNERHTML` occurrence is reviewed and accepted: the widgets render escaped HTML strings to stay under the 10 KB app-block limit, and merchant templates are allowlisted and sanitized. Details are available on request.
- **Data:** no protected customer data. Storefront analytics are anonymous, and the web pixel honours the customer privacy analytics setting.

## Feature video script

Target length 2–3 minutes, promotional, with no more than 25% screencast.

1. **0:00–0:15. Problem.** A shopper searches "trainers" and gets nothing, because the catalog says "running shoes". Message: lost sales from search.
2. **0:15–0:45. Instant search.** Results as you type, typos forgiven, synonyms and redirects.
3. **0:45–1:15. Filters and sorting.** Price, size and color filters on search and collection pages, matching the theme's look.
4. **1:15–1:45. Merchandising.** Pin a hero product for "summer", hide a sold-out item, boost a brand for a campaign.
5. **1:45–2:15. Insights.** Searches with no results, and a suggested synonym approved in one click.
6. **2:15–2:30. Close.** Works with your theme, prices follow each market, set up in minutes.
