# ADR 0003 (D3): PostgreSQL + Prisma

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
SQLite của template chỉ chạy một instance; admin, worker và search-api chạy nhiều process.

## Quyết định
PostgreSQL + Prisma 6.19 (khớp peer của `@shopify/shopify-app-session-storage-prisma@11`). Dev dùng container Postgres sẵn có, DB `search_app`/`search_app_test`.

## Hệ quả
Cấm SQLite ở production. Prisma 7 (config/adapter mới) cần ADR khi nâng.
