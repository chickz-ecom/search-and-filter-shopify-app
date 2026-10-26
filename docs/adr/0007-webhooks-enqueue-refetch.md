# ADR 0007 (D7): Webhook → queue → lấy lại dữ liệu qua GraphQL

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Webhook không đảm bảo thứ tự, có thể lỡ; handler phải trả lời < 5s.

## Quyết định
Handler chỉ xác thực HMAC, dedupe theo `X-Shopify-Webhook-Id`, enqueue rồi trả 200. Worker lấy bản mới nhất bằng `nodes(ids:)`. Production dùng Google Pub/Sub; dev dùng HTTPS.

## Hệ quả
Idempotent; không phụ thuộc payload. Route webhook không nằm dưới `app.tsx`.
