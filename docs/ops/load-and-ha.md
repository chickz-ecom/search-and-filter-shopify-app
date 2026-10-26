# Load, high availability and backups

Written for: whoever sizes and operates production (search-api, Typesense, Postgres, Redis).

## Load test: Black Friday ×10

Baseline target (task 2.1): 200 RPS with p95 < 120 ms. Black Friday ×10 means **2,000 RPS at the origin, with no CDN in front**, which is the worst case. All runs used 30,000 products, a mix of suggest, search with filters, price ranges and collection pages, 3,000 distinct queries with a Zipf distribution, `scripts/load-test-search.ts`.

Machine: one laptop (12 cores) running everything at once: the load generator, 8 search-api processes, a single Typesense node in Docker, Postgres and Redis.

| Run | Achieved | Errors | p50 | p90 | p99 |
|---|---|---|---|---|---|
| 50 RPS, 1 process (no contention) | 50 | 0 | 4 ms | 16 ms | 32 ms |
| 1,000 RPS, 8 processes | 1,000 | 0 | 17 ms | 146 ms | 318 ms |
| 2,000 RPS, 8 processes | 2,000 | 0 | 15 ms | 211 ms | 483 ms |
| Control: 2,000 RPS of `/v1/config` only (no search engine) | 2,000 | 0 | 3 ms | 9 ms | 76 ms |

What the runs showed:
- **Throughput holds with 0 errors at ×10.** Two bugs were found and fixed on the way:
  - **Postgres connections ran out on a cold start.** Hundreds of simultaneous requests each loaded the shop context. Fix: context loads are now deduplicated (single-flight), and search-api uses a pool of 5 connections per process.
  - **A Typesense timeout under saturation.**
- **The latency tail comes from Typesense CPU.** One search with facets costs 3–5 ms of CPU, and a request makes about 1.5 engine queries (filtered searches need a second query for facet counts). 2,000 RPS is about 15 CPU-seconds per second, which saturates a laptop's Docker VM. The control run shows the machine itself adds up to 76 ms at p99.

### Sizing for peak season

| Component | Normal | Black Friday (×10) |
|---|---|---|
| CDN in front of search-api | Required. `Cache-Control: max-age=30, stale-while-revalidate=300`, purged by tag on save | Expect ≥ 50% hits on popular queries |
| search-api | 2 replicas, 1 vCPU each | 6–8 replicas (stateless; scale on CPU) |
| Typesense | 3 nodes × 4 vCPU, RAM ≥ 2.5 × index size | 3 nodes × 8 vCPU (≈ 4,800 engine queries/s at 5 ms) |
| Rate limit | Plan RPM | `SEARCH_API_SHOP_RPM_MULTIPLIER=10` for the event |
| Postgres | Managed, 2 vCPU | Unchanged (search-api only reads it on a cold context) |

Engine queries per second ≈ origin RPS × 1.5. Budget 5 ms of CPU per query for catalogs up to 30k products, and 10 ms for 100k–300k (more documents per facet). Hybrid AI search adds about 5 ms.

## High availability

### Typesense: 3-node Raft cluster

`deploy/typesense-ha/docker-compose.yml` runs a 3-node cluster. In production, put each node on its own machine and availability zone. Clients list every node:

```
TYPESENSE_NODES=https://ts1.internal:8108,https://ts2.internal:8108,https://ts3.internal:8108
```

Failover test (`scripts/ha-failover-test.ts`, run locally):
- **Method:** index 2,000 documents, search continuously, stop the **leader**, write during the outage, then restart the node.

| Check | Result |
|---|---|
| Searches during failover | 2,459 OK, **0 failed** (the client retries the other nodes) |
| Writes while one node is down | Accepted after the new leader was elected |
| Restarted node | Caught up with writes made while it was down |

Typesense Cloud: choose a High Availability cluster (3 nodes) and use the nodes it lists, or its load-balanced endpoint.

### Everything else

| Component | HA setup |
|---|---|
| search-api | ≥ 2 replicas behind the load balancer and CDN. Stateless. |
| workers | ≥ 2 replicas. BullMQ locks jobs, so a crash only retries the job. |
| admin app | ≥ 2 replicas. Sessions live in Postgres. |
| Postgres | Managed with a standby replica and automatic failover. |
| Redis | Managed with a replica and AOF persistence (`appendfsync everysec`). Queues live here. |

When Typesense is unreachable, the storefront keeps showing Shopify's native results (503 → fallback), so an engine outage degrades search but never breaks the store.

## Backups and restore

| Data | Backup | RPO | Restore |
|---|---|---|---|
| Postgres (settings, merch, analytics) | Provider point-in-time recovery, 14 days | ≤ 5 min | Provider PITR to a new instance, then point `DATABASE_URL` at it |
| Typesense indexes | Nightly snapshot job (`TYPESENSE_SNAPSHOT_DIR`, 02:30 UTC) plus a sidecar that copies the snapshot directory to object storage | 24 h, then delta sync catches up | See below |
| Redis (queues, counters) | AOF on a managed replica | ≈ 1 s | Provider failover. Lost counters affect only today's analytics. |

### Restore Typesense

1. **From a snapshot (fast, minutes):** stop the node, replace its `--data-dir` with the latest snapshot directory, then start it. For a cluster, restore one node, start it alone (with a nodes file listing only itself), then add the others; they copy its data. Delta sync (every 5 minutes) and the nightly checksum fix anything changed since the snapshot.
2. **From Shopify (slow, always works):** run `npx tsx scripts/reindex-all.ts`. It queues a full sync for every installed shop, smallest first. Storefronts show native results until their shop finishes.

Test a restore every quarter, and record how long it takes.
