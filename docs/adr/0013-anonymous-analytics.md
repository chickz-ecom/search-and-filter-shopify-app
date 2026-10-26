# ADR 0013 (D13): Analytics ẩn danh

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md mục 2, docs/01-RESEARCH.md

## Bối cảnh
Giữ Protected Customer Data ở Level 0.

## Quyết định
Không lưu customer id; chỉ query, click, add-to-cart, doanh thu tổng hợp theo ngày.

## Hệ quả
Analytics không cần `read_orders` hay xin Level 1/2. Lưu tổng hợp 13 tháng (job dọn hằng giờ).

## Cập nhật 2026-10-26 (D17, task 2.15)
Xếp hạng bán chạy theo đơn là tính năng **tuỳ chọn**: merchant bật ở Sorting → optional scope `read_orders` → cần
Protected Customer Data **Level 1** (không phải Level 2: app không đọc trường khách hàng nào — test grep query).
Chỉ lưu `OrderLine(orderId, productId, qty, revenue, createdAt)` 60 ngày; tắt → xoá hết + gỡ webhook + revoke scope.
Analytics vẫn ẩn danh như trên. Xem [0017](0017-order-based-best-selling.md).
