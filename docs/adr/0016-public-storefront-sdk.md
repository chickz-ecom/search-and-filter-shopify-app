# ADR 0016 (D16): Storefront SDK công khai `window.SearchApp`

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Theme dev/agency cần tự làm section mà không fork widget.

## Quyết định
SDK v1 (semver): JSON API, event, template không `eval`, `data-searchapp-mount`, tài liệu ở `docs/developers/`.

## Hệ quả
Đổi chữ ký → cập nhật docs + changelog; chỉ break ở major, deprecate trước ≥ 90 ngày; contract test snapshot `.d.ts`.
