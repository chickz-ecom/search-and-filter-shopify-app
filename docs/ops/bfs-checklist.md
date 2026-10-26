# Built for Shopify checklist

Written for: the team submitting the app for review and the Built for Shopify badge.

Status as of 2026-10-26. "Verified locally" means automated tests or measurements in this repo. Items that also need a real store or the Partner Dashboard link to `docs/HUMAN_TODO.md`.

| # | Requirement | Status | Evidence | Still to confirm on a real store |
|---|---|---|---|---|
| 1 | Latest App Bridge in `<head>`; session token / token exchange; works without third-party cookies | Verified locally | `AppProvider` (`@shopify/shopify-app-react-router` 4.x) injects `app-bridge.js` and Polaris web components; every `app.*` loader and action awaits `authenticate.admin` (token exchange, embedded auth). No cookies are used for auth. | I1: open in both admin designs |
| 2 | Managed install; expiring offline tokens; OAuth runs on install and reinstall | Verified locally | `shopify.app.toml` has no legacy install flow; `future.expiringOfflineAccessTokens: true`; reinstall reactivates the shop and queues a sync (`install.int.test.ts`). | A2/C1 |
| 3 | GraphQL Admin API only, version 2026-10 | Verified locally | No REST calls; `api_version = "2026-10"` in config, server and Storefront calls (`test/app-config.test.ts`, security check `EOL_API_VERSION`). | — |
| 4 | Polaris web components 2.x; `s-app-nav`; Save Bar on every form; `s-modal` | Verified locally | All 11 admin view components pass Shopify's validator (polaris-app-home v2.0). Save Bar on Search, Sorting, Filters, Appearance and Developers; Merchandising edits in `s-modal`. View tests assert `ui-save-bar`. | I1 |
| 5 | Home shows setup status, embed status (`app.extensions()`) and KPIs; onboarding can be dismissed | Verified locally | `HomeView` setup guide, embed badge from `shopify.app.extensions()`, 7-day KPIs, dismiss action (`HomeView.test.tsx`). | I1 |
| 6 | Live preview for Appearance | Verified locally | Sandboxed preview iframe next to the editor, using the widget's real CSS and templates (`AppearanceView.test.tsx`). | I3 |
| 7 | No separate sign-up or login | Verified locally | Managed install only; no account system. | — |
| 8 | Storefront only through a theme app extension; no ScriptTag; no Asset API writes | Verified locally | App embed and 2 app blocks plus a web pixel; security checks `SCRIPT_TAG_*` and `DEPRECATED_SCRIPT_TAG_SCOPE` pass; no `write_themes` scope. | G1–G4 |
| 9 | Lighthouse drop ≤ 10 points (internal target ≤ 5) | Verified on a fixture | Weighted drop 0.4 points (`scripts/lighthouse-compare.mjs`, CI). App-block JavaScript under 10 KB; Theme Check clean. | G3 on Horizon |
| 10 | Admin Web Vitals p75: LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms | Verified on fixtures; field data collected | 24 admin pages on desktop and Pixel 7: CLS p75 0.000, LCP p75 ≤ 372 ms (`e2e/admin.spec.ts`). Real-user vitals reported via `shopify.webVitals.onReport` to `/app/vitals`. | I1 + 28 days of field data |
| 11 | 3 compliance webhooks; wrong HMAC returns 401; `shop/redact` deletes everything | Verified locally | `compliance_topics` in config; HMAC verification tests; redact removes engine collections, database rows and Redis keys (`lifecycle.int.test.ts`). | C1 |
| 12 | Managed pricing; merchants change plans themselves | Verified locally | Shopify App Pricing via the Partner API; Plans page opens Shopify's plan selection page; nightly plan refresh. | J1–J3 |
| 13 | No pressure tactics; features outside the plan clearly disabled | Verified locally | Over the plan limit, search keeps working and an info banner explains; AI search and headless switches are disabled with a reason and a link to Plans. | — |
| 14 | 50 net installs and 5 reviews | After launch | — | After the App Store listing goes live |

Also relevant to review:
- **Security:** `shopify app security check` passes 35 of 35 agent checks (`docs/ops/security.md`).
- **Accessibility:** storefront widgets pass axe (WCAG 2 A/AA, no serious or critical issues) in `e2e/storefront.spec.ts`.
- **Mobile:** every admin page is checked on a phone viewport.
