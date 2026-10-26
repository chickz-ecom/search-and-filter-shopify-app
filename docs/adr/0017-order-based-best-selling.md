# ADR 0017 (D17): Bán chạy theo đơn 60 ngày gần nhất

- Trạng thái: Accepted (2026-10-26)
- Nguồn: docs/02-PLAN.md D17, task 2.15

## Bối cảnh
Xếp hạng `BEST_SELLING` của Storefront API không minh bạch về cửa sổ thời gian và chỉ cập nhật theo lượt đêm.
Merchant muốn "bán chạy" phản ánh đơn gần đây, chọn được tiêu chí.

## Quyết định
- Optional scope `read_orders`, merchant tự bật ở trang Sorting (App Bridge `shopify.scopes.request`); mặc định vẫn
  dùng Storefront `BEST_SELLING`.
- Nạp lần đầu bằng bulk đơn 60 ngày (`groupObjects`), cập nhật bằng webhook `orders/create|updated|cancelled` **đăng ký
  theo shop qua GraphQL** sau khi có quyền (TOML chỉ khai được topic của scope bắt buộc), gỡ khi tắt.
- `currentQuantity` (đã trừ hoàn/huỷ/chỉnh sửa); bỏ đơn huỷ và đơn test.
- Hạng tính trong khung 15 phút (debounce), chỉ ghi `best_selling_rank` cho sản phẩm đổi hạng; tiêu chí số lượng / số đơn
  / doanh thu dòng (tiền tệ shop).
- Chỉ lưu id + số lượng + doanh thu dòng + ngày, 60 ngày.

## Hệ quả
- Cần Protected Customer Data Level 1 trong Partner Dashboard (HUMAN_TODO P1); privacy policy nêu rõ.
- Tắt: xoá OrderLine, gỡ webhook, revoke scope, xếp lại hạng từ Storefront ngay.
