# ADR 0004 (D4): Redis + BullMQ cho queue sync và cache

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Cần debounce, retry, rate limit theo shop, job định kỳ (delta 5 phút, checksum đêm), cache config cho search-api.

## Quyết định
Redis + BullMQ; prefix key cấu hình được (`REDIS_PREFIX`), Redis `maxmemory-policy noeviction`.

## Hệ quả
Worker là process riêng (`workers/`). Redis managed ở production (task 6.4).
