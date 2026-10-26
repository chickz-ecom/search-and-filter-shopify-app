# ADR 0009 (D9): Search API riêng (Hono)

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Traffic storefront không được ảnh hưởng admin; cần độ trễ thấp và cache CDN.

## Quyết định
`services/search-api` (Hono, stateless) deploy tách; dùng chung code `app/lib` (config, query builder) qua bundle esbuild.

## Hệ quả
Cache config Redis + CDN purge theo tag `shop`; trả 503 khi engine lỗi để client giữ kết quả native.
