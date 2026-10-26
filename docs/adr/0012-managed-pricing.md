# ADR 0012 (D12): Billing qua Shopify managed pricing theo số sản phẩm

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Chuẩn App Store; merchant tự đổi gói.

## Quyết định
Managed pricing. Gói: Free (< 100 sản phẩm) · $9 (1k) · $19 (5k) · $49 (30k) · $99 (100k) · $199 (300k). Headless API từ gói $49.

## Hệ quả
Tính năng ngoài gói disable rõ ràng, không pattern gây áp lực.
