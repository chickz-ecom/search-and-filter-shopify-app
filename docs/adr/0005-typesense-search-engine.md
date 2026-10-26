# ADR 0005 (D5): Typesense sau interface SearchEngine

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Cần typo, facet, synonym, override, alias swap và đổi trọng số lúc query.

## Quyết định
Typesense 30.x; mọi truy cập qua interface `SearchEngine` (`app/lib/search`). Trọng số dùng `query_by_weights` (0–127) lúc query, không re-index.

## Hệ quả
Đổi engine chỉ cần implementation mới của interface. Dev: Typesense docker; production: Typesense Cloud hoặc self-host (cấu hình cả hai, task 6.4).
