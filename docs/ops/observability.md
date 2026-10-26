# Observability

Written for: whoever is on call for the app (search-api, workers, Typesense).

## Endpoints

| Process | Endpoint | Auth |
|---|---|---|
| search-api | `GET /metrics` | `Authorization: Bearer $METRICS_TOKEN` (endpoint disabled when unset) |
| search-api | `GET /health` | none |
| worker | `GET :$WORKER_METRICS_PORT/metrics` (default 9464) | same bearer token |
| worker | `GET :$WORKER_METRICS_PORT/health` | none |

Prometheus config and alert rules: `deploy/observability/`. Labels never include the shop, to keep cardinality low. Per-shop detail lives in the admin (Sync page, Analytics) and in logs.

## Metrics

| Metric | Type | What it tells you |
|---|---|---|
| `searchapp_http_request_duration_seconds{route,status}` | histogram | search-api latency per route pattern. p95 = `histogram_quantile(0.95, …)`. Target < 80 ms at the server. |
| `searchapp_engine_unavailable_total` | counter | Requests answered 503 because Typesense was unreachable. Storefronts kept native results. |
| `searchapp_storefront_pricing_total{result}` | counter | Storefront API price lookups reported by the SDK. Errors are always sent, successes are sampled at 10% and scaled back. Error rate = error / total. |
| `searchapp_queue_jobs{queue,state}` | gauge | BullMQ depth (waiting, active, delayed, failed), read at scrape time. |
| `searchapp_event_to_index_seconds{type}` | histogram | Shopify event enqueued → product searchable (includes the 3 s debounce). Target < 60 s. |
| `searchapp_job_duration_seconds{type}` | histogram | Processing time per job type (full, delta, checksum, …). |
| `searchapp_job_failures_total{type}` | counter | Failed job attempts (BullMQ retries them). |
| `searchapp_delta_lag_seconds` | gauge | Oldest delta watermark among active shops. Large values mean webhooks and deltas both missed changes. |

## Runbooks

### Search latency
1. Check Typesense CPU and memory, and `search_time_ms` in its logs. Hybrid (AI) search adds about 5 ms per query.
2. Check the CDN hit rate. `X-Cache: HIT` responses never reach Typesense.
3. Scale search-api horizontally. It's stateless; the micro-cache is per process.

### Engine down
Storefronts fall back to Shopify's native results automatically. Restore Typesense (see `docs/ops/deploy.md`, HA cluster). After recovery, nothing needs re-indexing: webhooks queued in BullMQ are processed and the next delta catches up.

### Queue backlog
1. `searchapp_queue_jobs{state="active"}` at the concurrency limit → raise `WORKER_CONCURRENCY` or add worker replicas.
2. Many `full` jobs → a mass re-index (schema change, plan change). It drains on its own.
3. Shopify throttling shows up as long `job_duration` for incremental jobs. The executor waits on cost; no action needed.

### Job failures
Read the worker logs for the job id. Common causes: an expired offline token (shop uninstalled, handled by `app/uninstalled`), Typesense down, a bulk operation that failed (the Sync page shows the error and the merchant can retry).

### Sync latency
If `event_to_index` p95 rises but the queue is empty, check webhook delivery in the Partner Dashboard. The delta every 5 minutes and the nightly checksum fix missed events.

### Pricing errors
Shoppers see "View price" instead of a wrong price. Check the Storefront API status, then whether a shop changed markets (the SDK uses `@inContext(country:)`). Errors limited to one shop usually mean its storefront password or domain changed.
