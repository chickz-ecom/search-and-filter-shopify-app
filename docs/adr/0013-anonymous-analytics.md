# ADR 0013 (D13): Analytics ẩn danh

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Giữ Protected Customer Data ở Level 0.

## Quyết định
Không lưu customer id; chỉ query, click, add-to-cart, doanh thu tổng hợp theo ngày.

## Hệ quả
Không cần `read_orders` hay xin Level 1/2.
