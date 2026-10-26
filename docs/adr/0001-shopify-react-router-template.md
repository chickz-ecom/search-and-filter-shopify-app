# ADR 0001 (D1): Shopify React Router v7 template

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Shopify đã gộp Remix vào React Router; template Remix chỉ còn cho app cũ. `@shopify/shopify-app-react-router@4` cần Node ≥ 22 và mặc định Polaris 2.x.

## Quyết định
Dùng `shopify-app-template-react-router`, `@shopify/shopify-app-react-router@^4`, TypeScript, Node 22 (`.nvmrc`). Pin `react-router@7.x` (hiện 7.18.4), **không** lên v8.

## Hệ quả
Loader/action/route module như Remix. Nâng react-router chỉ trong nhánh 7.x; v8 cần ADR mới.
