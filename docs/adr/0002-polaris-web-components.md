# ADR 0002 (D2): Polaris web components 2.x + App Bridge CDN

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Polaris React đã deprecate; BFS yêu cầu Polaris 2 trước 01/05/2027 và hiển thị đúng ở cả hai giao diện admin.

## Quyết định
Admin chỉ dùng `s-*` (Polaris 2.x, `polaris-2.js` do `AppProvider` chèn) và App Bridge CDN. Cấm `@shopify/polaris` React và `ui-nav-menu`.

## Hệ quả
Không có sẵn Combobox/Tabs/RangeSlider → tự ghép từ primitive. Kiểu JSX từ `@shopify/polaris-types@^2`.
