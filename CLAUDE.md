# CLAUDE.md — Shopify Search & Filter app

Đây là app Shopify public: search, filter, sorting, merchandising, analytics và SDK công khai cho theme dev. Mục tiêu là đạt **Built for Shopify**.

## Đọc trước khi làm
1. `docs/01-RESEARCH.md`: cách các app đối thủ index, sync và search; chuẩn Shopify tháng 10/2026.
2. `docs/02-PLAN.md`: kiến trúc, quyết định D1–D14, lộ trình theo phase và checkbox. **Làm theo thứ tự phase, tick `[x]` khi đạt DoD, ghi vào mục Nhật ký.**

## Stack (không tự ý đổi)
- Shopify **React Router v7** template (`@shopify/shopify-app-react-router@^4`); `react-router@7.x`, không lên v8. Node 22, TypeScript.
- Admin dùng **Polaris web components 2.x** (`s-*`) cùng App Bridge CDN. **Không** dùng `@shopify/polaris` React.
- GraphQL Admin API, version `2026-10`. Không dùng REST.
- PostgreSQL + Prisma · Redis + BullMQ · Typesense (qua interface `SearchEngine`).
- Storefront chỉ dùng theme app extension (app embed và app block) cùng web pixel. Không dùng ScriptTag, không ghi Asset API.

## Lệnh
- `shopify app dev` · `shopify app deploy` · `shopify app webhook trigger --topic <topic>`
- `docker compose up -d` (postgres, redis, typesense)
- `npm run typecheck && npm test` phải pass trước khi tick một task.

## Quy tắc
- Không đoán API của Shopify. Kiểm tra trên shopify.dev hoặc Dev MCP, rồi validate query bằng `shopify app execute` hoặc GraphiQL.
- Webhook handler: xác thực rồi enqueue, trả 200 nhanh, xử lý idempotent. Route webhook không đặt dưới `app.tsx`.
- JS storefront mỗi block ≤ 10 KB gzip; Lighthouse giảm ≤ 5 điểm.
- Form admin phải có Contextual Save Bar; Home phải hiển thị trạng thái embed qua `shopify.app.extensions()`.
- **Giá hiển thị** lấy từ Storefront API: một query `nodes(ids:)` với `@inContext(country, language)` cho cả trang kết quả. Index chỉ lưu giá gốc, dùng cho filter và sort. Không dùng `Shopify.currency.rate`.
- Trọng số và bật/tắt trường search áp dụng lúc query (`query_by_weights`), không re-index. Sort được dựng từ `SortOption`, tối đa 3 trường.
- `window.SearchApp` (SDK v1) là hợp đồng công khai: đổi chữ ký nào cũng phải cập nhật `docs/developers/` và changelog.
- Bí mật chỉ lấy từ env.
