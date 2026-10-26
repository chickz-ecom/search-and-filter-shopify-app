# Security

Written for: the team preparing App Store and Built for Shopify review, and whoever changes code that touches auth, storefront rendering or merchant input.

## Shopify app security check

Run `shopify app security check --path .`, have a coding agent run the agent checks, then `shopify app security record < findings.json` and `shopify app security review`. Results live in `.shopify/app-security/` (git-ignored). Run it again before every submission.

Result on 2026-10-26: **35 of 35 agent checks pass, with 0 findings.** One deterministic finding remains as a reviewed, accepted design (see below).

Issues the check found or prompted, all fixed in task 6.3 with tests:

| Issue | Fix |
|---|---|
| A merchant template could carry `<img/onerror=…>` past the old regex and run script on the storefront | Allowlist validator on save (`templateProblem` in `app/lib/config/appearance.ts`), plus SDK sanitizing when config loads (`packages/storefront-sdk/src/sanitize.ts`) |
| Instant search links trusted API URLs (`javascript:` was possible) | `safeHref` allowlist (relative or http(s) only) for every link the widgets build, and for redirect navigation |
| Redirects accepted `/\evil.com` (browsers read it as `//evil.com`) and `javascript://<shop>/%0a…` | `RedirectInput` rejects backslashes and control characters, and requires `http(s):` for absolute URLs |
| `read_publications` and `read_product_listings` requested but unused | Removed from `shopify.app.toml` (a test pins the exact scope set) |
| The optional `read_online_store_pages` scope was requested but pages and articles were never indexed | Pages and articles are now indexed (`app/lib/sync/content.server.ts`); optional scopes are `read_content` and `read_online_store_pages` |
| Admin routes authenticated inside a helper the checker couldn't see | Every loader and action now calls `await authenticate.admin(request)` itself |
| `deepmerge-ts` advisory via the Prisma CLI | npm `overrides` → 8.x; `npm audit --omit=dev` reports 0 |
| No dependency automation | `.github/dependabot.yml` |
| A shop's config stayed cached up to 5 minutes after uninstall | Purged on uninstall |

Block settings in Liquid are escaped, Theme Check is clean, and both run in CI.

## Accepted findings and risks

### `UNSAFE_INNERHTML` (deterministic, 9 occurrences)

The storefront widgets (`packages/storefront-ui/src/{results,instant}.ts`) build HTML strings and assign them with `innerHTML` / `insertAdjacentHTML`. This is deliberate: the app-block JavaScript must stay under 10 KB, and a sanitizer library such as DOMPurify doesn't fit.

What makes it safe:
- Every interpolated value goes through `esc()` or the SDK template engine, which HTML-escapes all output and turns `javascript:` URLs into `#`.
- URLs the widgets build pass `safeHref`.
- Merchant templates are allowlisted on save and sanitized again in the browser before use.
- `sanitize.ts` parses into an inert `<template>` element, which is also flagged but runs nothing.
- `e2e/xss.spec.ts` renders hostile product titles, vendors, facet values, sort labels, URLs, query parameters and a hostile stored template, then asserts no dialog, no `on*` attribute, no inline script and no `javascript:` link (desktop and mobile).

Any new `innerHTML` in these files must only receive escaped strings. Add a case to `e2e/xss.spec.ts` when you add one.

### Headless plan gate relies on the `Origin` header

`/v1/*` treats requests from the shop's own storefront origins as storefront traffic, and anything else as headless (Pro plan plus merchant opt-in). A server-side client can forge `Origin`, so it can skip the *plan* gate. It still needs the shop's public key, and it only receives public storefront search data: no cross-tenant access, no private data. Per-shop rate limits still apply. This is a billing-enforcement limit, not a data-security issue.

### Public key is public by design

The public key appears in theme Liquid and storefront requests. It identifies a shop for read-only search of public catalog data, like a Storefront API tokenless request.

## Boundaries worth knowing

| Boundary | Where |
|---|---|
| Admin auth (session token, token exchange) | `authenticate.admin` in every `app.*` loader and action |
| Webhooks and Events | HMAC-SHA256 over the raw body, timing-safe, 401 on failure (`app/lib/webhooks/verify.server.ts`); deduplicated by webhook id |
| App proxy | Signature verified with a ±1 h window before the request is rewritten to the search API (`app/lib/search-service/app-proxy.server.ts`) |
| Tenant isolation | Every admin write is keyed by the session shop's id. Typesense access uses a scoped key per shop that can only read that shop's collections. |
| Internal endpoints | `/internal/purge` (shared secret), `/metrics` (bearer token). Both are disabled when unset. |
| Secrets | Env only (`app/lib/env.server.ts`). Nothing secret reaches browsers or logs (checked by `CREDENTIAL_*` checks). |
