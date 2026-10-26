# ADR 0010 (D10): Storefront chỉ qua theme app extension

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
ScriptTag đã ngừng tạo từ 01/10/2026; BFS cấm ghi Asset API.

## Quyết định
1 app embed (`body`) + 2 app block (`search-results`, `collection-filter`) + web pixel.

## Hệ quả
Không chạm file theme. App block chỉ dùng được trên template JSON (OS 2.0).
