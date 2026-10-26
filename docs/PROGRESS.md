# PROGRESS — Shopify Search & Filter app

> Đọc file này đầu tiên khi tiếp tục phiên. Nguồn sự thật: `docs/02-PLAN.md` (checkbox + Nhật ký).
> Tiếp tục: `cat docs/PROGRESS.md && git log --oneline -20 && grep -n "\[ \]\|\[~\]" docs/02-PLAN.md | head`

## Hiện tại
- Phase: 2 — Search API, Currency, SDK, Storefront
- Task: 2.9 (packages/storefront-ui)

## Đã xong
- Phase 0: 0.1–0.5 (template RR7 + shopify-app-react-router v4 + polaris-types v2, React 19, Postgres/Prisma, Typesense docker, Vitest/Playwright/CI, shopify.app.toml, ADR D1–D16).
- Phase 1: 1.1–1.14 xong (xem tổng kết bên dưới).
- Phase 2: 2.1 search-api (load test 204 RPS, p99 78 ms), 2.2–2.4 builders, 2.5 merch, 2.6 SDK (5,97 KB gzip), 2.7 pricing Storefront API, 2.8 phương án B.
- Mẫu làm việc: dùng `scratchpad/check.sh` (prettier+typecheck+lint+test) trước mọi commit; `scratchpad/rep.py` để sửa file (báo lỗi nếu không tìm thấy chuỗi).


## Bị chặn / `[~]`
- (chưa có) — các phần cần Shopify thật nằm trong docs/HUMAN_TODO.md (A–D).

## Quyết định tự đưa ra (chi tiết trong Nhật ký 02-PLAN.md)
- Dev dùng lại Docker sẵn có: Postgres `postgres_db` (DB `search_app`, `search_app_test`), Redis `docker-redis-1` (DB 5, test DB 6, prefix `sa:`). Compose dự án chỉ chạy Typesense 30.1.
- Node 22.23.4 qua nvm (`.nvmrc`); lệnh: `export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH`.
- React 19 (Polaris web components controlled fields cần React 19). `app/types/app-bridge-jsx.d.ts` nối JSX.
- Typesense 30: synonym_sets / curation_sets (không còn synonyms/overrides theo collection).
- matchMode mặc định `max_weight` (đo: max_score chỉ dùng trọng số để tie-break).
- Incremental tách query: core ≤ 50 ID (~750 điểm), variants qua productVariants(query: product_ids), collections ≤ 18 ID/request.
- Bulk collections chạy `groupObjects: true` để giữ thứ tự (pos_*). Products/variants phẳng `groupObjects: false`.
- Staging: RAM ≤ 20k sản phẩm, Postgres UNLOGGED khi lớn hơn. Import Typesense bằng fetch native (client typesense rò bộ nhớ).
- Online Store visibility: `onlineStoreUrl != null` (publishedOnCurrentPublication đã deprecated).
- Bỏ webhook product_listings/collection_listings (chỉ cho kênh riêng của app).
- URL filter dùng đúng tham số native `filter.p.*`/`filter.v.*` → fallback native dùng chung URL.
- Tra cứu Shopify: `docs/shopify-api/*.md` + operation đã validate trong `docs/shopify-api/admin|storefront/*.graphql`.
  Client MCP nhỏ ở scratchpad (`@shopify/dev-mcp`, tool `validate`); conversationId 213cbac3-3f5a-42e9-a142-1d5ebad96e39.

## Môi trường
- node v22.23.4 · npm 10.9.9 · Shopify CLI 4.9.4 (chưa đăng nhập) · Docker 24.0.7 · git 2.50.1

## Tổng kết Phase 1 (2026-10-26)
- Sync đủ 4 lớp: full sync (bulk phẳng song song + shard + lượt sớm + alias swap), incremental (webhook/Events → debounce → nodes(ids) theo lô, đột biến → delta bulk), delta 5 phút theo watermark, checksum đêm (chỉ sửa phần lệch). Không full re-index hằng đêm.
- DoD phase (bằng test tích hợp với Postgres/Redis/Typesense thật + Shopify giả lập):
  - Sửa sản phẩm → search đổi: 3,2 s (webhook → BullMQ → worker → Typesense; debounce 3 s) ≪ 60 s.
  - 1.000 sự kiện dồn dập (có trùng lặp): không mất, index đủ trong 3,5 s.
  - Re-index không downtime: alias swap, collection cũ xoá sau swap; lệch > 2% giữ alias cũ.
- Benchmark phía app (chưa gồm thời gian Shopify chạy bulk): 30k sp 4,0 s (RAM) / 7,6 s (PG); 100k 25,8 s heap ≤ 256 MB; checksum 30k 0,9 s, 0 lần ghi.
- BFS liên quan: chỉ GraphQL 2026-10; 3 compliance webhook, HMAC sai → 401; shop/redact xoá sạch (engine + DB + Redis).
- Việc cần store thật: HUMAN_TODO D1–D7 (fixture thật, benchmark bulk, Events smart collection, CSV 30k, best-selling).

## Bước tiếp theo
- Phase 2: 2.1 search-api (Hono) dùng query/sort/filter builder đã có (2.2–2.4), rồi 2.5 merch, 2.6 SDK, 2.7 pricing...
