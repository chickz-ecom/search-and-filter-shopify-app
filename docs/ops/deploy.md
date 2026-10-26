# Deploy

Written for: whoever sets up and runs production.

## What runs where

One Docker image (`Dockerfile`) holds three processes. Pick one with the start command:

| Process | Command | Port | Scale |
|---|---|---|---|
| Admin (embedded app, webhooks, app proxy) | `npm run docker-start` (runs `prisma migrate deploy`, then serves) | `PORT` (3000) | ≥ 2 instances |
| search-api (storefront and headless search) | `npm run start:search-api` | `SEARCH_API_PORT` (8787) | ≥ 2, behind a CDN; 6–8 for Black Friday |
| worker (sync, webhooks queue, nightly jobs) | `npm run start:worker` | `WORKER_METRICS_PORT` (9464, `/health` + `/metrics`) | ≥ 2 |

Supporting services:
- **Postgres 16:** managed, point-in-time recovery 14 days.
- **Redis 7:** managed, AOF on, and **`maxmemory-policy noeviction`**, which BullMQ requires.
- **Typesense 30.1:** Typesense Cloud HA (3 nodes) or self-hosted with `deploy/typesense-ha`.

The storefront traffic path is: theme → `/apps/search/*` (Shopify app proxy, signed) → admin `/proxy/*`, which verifies the signature and handles the request in-process. Headless clients call search-api directly. Put a CDN in front of search-api; it honours `Cache-Control` and purges by the `shop-{domain}` tag (`CDN_PURGE_URL`, `CDN_PURGE_TOKEN`).

## Ready-made configs

| File | Use |
|---|---|
| `deploy/render/render.yaml` | Render Blueprint: the three services from one image, plus managed Postgres and Redis (Key Value). Field names need checking against current Render docs (HUMAN_TODO M1). |
| `deploy/selfhost/docker-compose.yml` | A single host with everything, including Postgres, Redis and Typesense. Good for staging or small installs. |
| `deploy/typesense-ha/docker-compose.yml` | 3-node Typesense cluster (Raft) |
| `deploy/observability/` | Prometheus scrape config and alert rules |

Smoke-tested locally on 2026-10-26: the image built, and all three containers started against Postgres, Redis and Typesense.
- **search-api:** `/health` OK, `/metrics` behind its token.
- **worker:** `/health` OK, queue metrics reported.
- **admin:** migrations applied, `/` returned 200, and `/app` refused unauthenticated access.

## Environment variables

Secrets come from the environment only. `.env.example` lists every variable with comments.

| Variable | Needed by | Notes |
|---|---|---|
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | admin, worker | From the Partner Dashboard |
| `SHOPIFY_APP_URL`, `SCOPES` | admin | App URL (HTTPS). `SCOPES` must match `shopify.app.toml` |
| `DATABASE_URL`, `REDIS_URL`, `REDIS_PREFIX` | all | search-api adds `connection_limit=5` itself |
| `TYPESENSE_NODES` (or `TYPESENSE_HOST`/`PORT`/`PROTOCOL`), `TYPESENSE_API_KEY` | all | Admin key: admin and worker only, ideally |
| `TYPESENSE_SEARCH_ONLY_KEY` | search-api, admin | Required in production (the admin key is a fallback with a warning) |
| `TYPESENSE_EMBED_MODEL` | worker | AI search model (default `ts/all-MiniLM-L12-v2`) |
| `TYPESENSE_SNAPSHOT_DIR` | worker | Turns on nightly snapshots (path on the Typesense host) |
| `SEARCH_API_PUBLIC_URL` | admin, worker | Written into the theme config and pixel at install. Use the CDN URL. |
| `INTERNAL_API_SECRET` | admin, search-api | Lets the admin purge search-api caches |
| `METRICS_TOKEN` | search-api, worker | Bearer token for `/metrics` |
| `SEARCH_API_IP_RPM`, `SEARCH_API_SHOP_RPM_MULTIPLIER` | search-api | Rate limits; set the multiplier to 10 for peak season |
| `WORKER_CONCURRENCY`, `WORKER_METRICS_PORT` | worker | Default 8 and 9464 |
| `CDN_PURGE_URL`, `CDN_PURGE_TOKEN` | admin | Tag purge (Cloudflare `purge_cache`) |
| `SHOPIFY_APP_GID`, `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN`, `SHOPIFY_APP_HANDLE` | admin, worker | Shopify App Pricing (Partner API) |
| `DEVELOPER_DOCS_URL` | admin | Link on the Developers page |
| `SEARCH_DEFAULT_LOCALE` | search-api | Fallback locale |
| `SHOP_CUSTOM_DOMAIN`, `SHOPIFY_SEARCH_THEME_ID` | admin | Optional (dev stores with custom domains; theme editor deep link) |

## Release steps

1. CI is green: typecheck, lint, tests, e2e, Theme Check, Lighthouse, Docker build.
2. Build and push the image: `docker build -t <registry>/searchapp:<sha> .`.
3. Deploy the admin first; its start command runs `prisma migrate deploy`. Migrations are additive, so search-api and the workers keep running on the old version meanwhile.
4. Deploy search-api and the workers.
5. Deploy extensions and app configuration: `shopify app deploy` (theme app extension, web pixel, webhooks, app proxy, scopes).
6. Watch `/metrics`: error rate, p95, queue depth, delta lag.

Rollback: redeploy the previous image tag. Migrations are only ever additive, so there are no down migrations. To remove a column, first ship code that stops using it, then drop it in a later release.
