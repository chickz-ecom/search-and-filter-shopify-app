# ADR 0006 (D6): Mỗi shop một collection + alias

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Cô lập tenant, re-index không downtime, xoá sạch khi `shop/redact`.

## Quyết định
Collection `p_{shopId}_v{n}` truy cập qua alias `p_{shopId}`; `c_{shopId}` cho collection/page/article. Full sync tạo version mới rồi swap alias.

## Hệ quả
Scoped search key theo shop chỉ cho phép alias của shop đó. Collection cũ được xoá sau swap.
