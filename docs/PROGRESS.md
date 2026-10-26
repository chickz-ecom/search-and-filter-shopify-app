# PROGRESS — Shopify Search & Filter app

> Đọc file này đầu tiên khi tiếp tục phiên. Nguồn sự thật: `docs/02-PLAN.md` (checkbox + Nhật ký).
> Tiếp tục: `cat docs/PROGRESS.md && git log --oneline -20 && grep -n "\[ \]\|\[~\]" docs/02-PLAN.md | head`

## Hiện tại
- Phase: 1 — Index và Sync
- Task: 1.5 (full sync + alias swap + early results + tiến độ)

## Đã xong
- Phase 0: 0.1–0.5 (template RR7 + shopify-app-react-router v4 + polaris-types v2, React 19, Postgres/Prisma, Typesense docker, Vitest/Playwright/CI, shopify.app.toml, ADR D1–D16).
- Phase 1: 1.1 executor throttle, 1.2 SearchEngine/Typesense, 1.3 bulk runner + staging + benchmark, 1.4 mapper.
- Phase 2 (logic thuần, làm sớm vì không phụ thuộc Shopify): 2.2 query builder, 2.3 sort builder, 2.4 filter/facet.

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

## Bước tiếp theo
- 1.5: hạ tầng queue (Redis/BullMQ), Shop service + afterAuth, full sync job (alias swap, early results, tiến độ).
- Sau đó 1.6 → 1.14 theo thứ tự.
