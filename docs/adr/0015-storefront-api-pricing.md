# ADR 0015 (D15): Giá hiển thị từ Storefront API (1 request/trang)

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Giá market (tỷ giá, điều chỉnh %, price list) không tính lại được ở client; `Shopify.currency.rate` không công bố.

## Quyết định
SDK gọi một query `nodes(ids:)` với `@inContext(country, language)` cho cả trang. Index chỉ lưu giá gốc cho filter/sort; khoảng giá quy đổi bằng rate suy ra từ response. Phương án B (`price_min_{CC}` cho price list cố định) đặt sau feature flag `fixedMarketPrices`.

## Hệ quả
Node `null` → ẩn sản phẩm. Lỗi/timeout → ẩn số tiền, hiện "Xem giá".
