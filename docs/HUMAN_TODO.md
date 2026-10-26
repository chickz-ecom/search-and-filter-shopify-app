# HUMAN_TODO — việc cần con người

> Thứ tự gợi ý từ trên xuống. Mỗi mục có lệnh/bước chính xác. Mục đã làm thì đánh `[x]`.

## A. Tài khoản & liên kết app (cần trước khi chạy thật)
- [ ] A1. Đăng nhập Shopify CLI: `shopify auth login` (hoặc chạy `shopify app dev` lần đầu sẽ mở trình duyệt).
- [ ] A2. Tạo app trong Partner Dashboard / Dev Dashboard và link config:
      `cd "<repo>" && shopify app config link` → chọn "Create new app" → tên "Search & Filter".
      Lệnh này điền `client_id` vào `shopify.app.toml`.
- [ ] A3. Tạo dev store (Dev Dashboard → Stores → Create dev store), bật preview admin mới.
      Chạy: `shopify app dev --feature-preview new_admin_design` → cài app vào dev store (DoD 0.1).

## B. CI / GitHub
- [ ] B1. Tạo repo GitHub, push `main`. Thêm secret `SHOPIFY_CLI_PARTNERS_TOKEN` (Partner Dashboard → Settings → CLI token)
      để job `shopify-config` chạy `shopify app config validate` (job này chỉ chạy khi push).

## C. Kiểm chứng cấu hình trên app thật (sau A2)
- [ ] C1. `shopify app config validate --json` → phải sạch lỗi (cú pháp đã đối chiếu docs, test `test/app-config.test.ts` chỉ kiểm cấu trúc).
- [ ] C2. `shopify app deploy --no-release` để Shopify kiểm complexity query Events (≤ 100 điểm) và webhook/app proxy.
- [ ] C3. Điền URL thật cho `application_url` và `[auth].redirect_urls` (CLI tự cập nhật khi `shopify app dev`).

## D. Kiểm chứng Sync trên dev store
- [ ] D1. Lấy JSONL bulk thật (products/variants/collections) từ dev store để thay fixture tổng hợp:
      `shopify app bulk execute --query "$(cat docs/shopify-api/admin/bulk-inner-products.graphql)"` rồi tải file `url`,
      cắt 20 dòng vào `app/lib/sync/__fixtures__/products.real.jsonl`; chạy `npx vitest run app/lib/sync`.
