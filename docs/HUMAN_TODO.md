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
- [ ] D2. Benchmark sync trên dev store thật (DoD 1.3: 30k ≤ 5 phút, 100k ≤ 15 phút). Cần store có 30k và 100k sản phẩm
      (5 variant, 10 metafield) — tạo bằng bulk mutation `productSet`. Lấy offline token của app (bảng Session), rồi:
      `npx tsx scripts/bench-sync.ts --live --shop <store>.myshopify.com --token <token> --nested`
      `npx tsx scripts/bench-sync.ts --live --shop ... --token ...` (phẳng song song)
      `npx tsx scripts/bench-sync.ts --live --shop ... --token ... --shards 2 --staging pg` (phẳng + shard)
      Ghi `bulks[].waitMs`, `totalMs`, `peakRss` vào Nhật ký của 02-PLAN.md.
- [ ] D3. Cài app lên dev store mới (≥ 2k sản phẩm), đo thời gian tới khi search có kết quả (lượt sớm: tối đa 1.000 sản phẩm hoặc 45 s;
      DoD 1.5: < 60 s) và xem Home hiện "Indexing: x/y". Chạy `npm run worker` song song với `shopify app dev`.
- [ ] D4. Thử webhook thật: `shopify app webhook trigger --topic products/update --address <tunnel>/webhooks/products --api-version 2026-10`
      (và `shop/redact`, `customers/redact`, `customers/data_request` → `/webhooks/compliance`). Kiểm tra 200 và job vào queue;
      gửi HMAC sai phải nhận 401.
- [ ] D5. (Task 1.8) Kiểm chứng Events trên dev store: tạo smart collection "tag = sale"; bỏ tag `sale` khỏi một sản phẩm.
      Xem log route `/api/events/collections` có nhận `collection.products` (fields_changed.removed) hay không → ghi kết quả vào Nhật ký.
      Dù không bắn, index vẫn phải cập nhật trong ≤ 1 phút nhờ `products/update` (incremental lấy lại product.collections).
      Thử thêm: đổi kiểu sắp xếp collection (Sort: Manual → Price) → event `collection.sortOrder` → pos_* bị xoá.
- [ ] D6. (DoD 1.9) Trên store Standard có 30k sản phẩm: import CSV sửa 30k sản phẩm → đo thời gian tới khi index khớp
      (mục tiêu ≤ 10 phút; app sẽ chuyển sang delta bulk vì > 2.000 ID). Chạy checksum đêm thủ công:
      thêm job `checksum` (BullMQ UI hoặc `node -e` với getSyncQueue().add) → kiểm tra < 2 phút và `writes: 0`.
- [ ] C4. Mở app trong admin (ngôn ngữ tài khoản = Tiếng Việt) → xác nhận URL app nhúng có `?locale=vi...`
      (app dùng tham số này để chọn en/vi, `app/i18n/index.ts`). Nếu không có, đổi sang đọc `session.locale` (online token).
- [ ] D7. (1.12) Trên dev store có đơn hàng thử: chạy job `best-selling` → so thứ tự `best_selling_rank` với Admin → Products
      sort "Best selling" của collection All. Xác nhận private token (`unauthenticated.storefront`) không bị 430.
