# ADR 0011 (D11): Render progressive (Liquid trước, JS hydrate)

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Đối thủ ẩn grid theme và tự vẽ lại → CLS, xung đột theme, trang trống khi engine lỗi.

## Quyết định
Block in sẵn kết quả native bằng Liquid (SEO + fallback); SDK hydrate trong vùng của block.

## Hệ quả
Engine lỗi vẫn có sản phẩm; giảm CLS; JS mỗi block ≤ 10 KB gzip.
