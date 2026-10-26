# ADR 0008 (D8): Events API cho thay đổi collection

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Webhook bỏ sót đổi thành viên và kiểu sắp xếp collection.

## Quyết định
Subscribe Events `Collection` (`collection.products`, `collection.sortOrder`) trong `shopify.app.toml`; lưới an toàn là poll đối soát.

## Hệ quả
Smart collection cần kiểm chứng thực tế (task 1.8 / HUMAN_TODO).
