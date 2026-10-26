# Privacy policy: Search & Filter

_Last updated: [DATE]. Operated by [COMPANY NAME], [ADDRESS]. Contact: [SUPPORT EMAIL]._

Search & Filter ("the app") gives Shopify stores product search, filters, sorting and merchandising. This policy explains what data the app processes when a merchant installs it, and why.

## Data we process

**Store data, from the Shopify Admin API, to build your search index:**
- **Catalog:** products, variants, prices, inventory availability, product options, tags, vendors, product types, collections and their product order, translations.
- **Store settings:** markets, currencies and languages.
- **Optional, only if you turn on page or article search:** your Online Store pages and blog articles.
- **Store details:** shop domain, base currency and languages.

**Orders, only if you turn on "Rank by orders" (Sorting page):** for orders from the last 60 days, the order id, order date, and for each product the quantity sold and line amount. This needs your permission to read orders. The app never reads customer names, emails, addresses, phone numbers or notes, and keeps this data for 60 days. Switching the feature off deletes it and returns the permission.

**Your app settings.** Search, sorting, filter, merchandising and appearance settings you save in the app.

**Anonymous search activity from your storefront:**
- What is recorded: search terms, whether a search had results, clicks on search results, filter and sort choices, and add-to-cart and purchase amounts that followed a search.
- How it's collected: through the app's search service and the app's web pixel. The pixel only runs when the shopper's privacy settings allow analytics.
- What is stored: daily totals per search term. No customer identity, email, address, order details or account data are collected or stored.
- **IP addresses** are used only to limit request rates. They sit in a short-lived rate-limit counter for up to two minutes and are never stored.

Apart from the optional order ranking above, the app does not access Shopify **protected customer data**, and even then it reads no customer fields.

## How we use it

To index your catalog and answer searches on your storefront, show your search analytics and suggestions in the app, operate and secure the service (rate limits, error monitoring), and bill your plan through Shopify.

We don't sell data, use it for advertising, or share it with other merchants.

## Retention and deletion

- **Search activity totals:** kept for 13 months, then deleted automatically.
- **Order ranking data (optional):** kept for 60 days, deleted when you turn the feature off.
- **When you uninstall:**
  1. The app stops serving search for your store immediately.
  2. When Shopify sends the `shop/redact` request (48 hours after uninstall), we delete your search index, settings and analytics.
  3. If that request never arrives, we do the same 7 days after uninstall.
- **Customer requests** (`customers/data_request`, `customers/redact`): the app stores no data about individual customers, so there is nothing to export or delete. We confirm this to Shopify.
- **Backups:** search index snapshots are kept for up to 14 days, and database backups for up to 14 days.

## Where data is processed

| Provider | Purpose | Region |
|---|---|---|
| [HOSTING PROVIDER] | App servers, database, queues | [REGION] |
| Typesense Cloud | Search index | [REGION] |
| [CDN PROVIDER] | Caching search responses | Global |

Data is encrypted in transit (HTTPS) and at rest by these providers.

## Your rights

Merchants can request a copy or deletion of their data at any time at [SUPPORT EMAIL]. We respond within 30 days. Shoppers should contact the store they bought from; the store can reach us on their behalf.

## Changes

We'll post updates on this page and notify installed merchants in the app of material changes.
