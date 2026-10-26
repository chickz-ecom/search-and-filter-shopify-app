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

## E. Hạ tầng search-api
- [ ] E1. Tạo Typesense key search-only cho search-api (không dùng admin key ở production):
      `curl -X POST $TS/keys -H "X-TYPESENSE-API-KEY: $ADMIN" -d '{"description":"search-api","actions":["documents:search"],"collections":["p_.*","c_.*"]}'`
      → đặt vào `TYPESENSE_SEARCH_ONLY_KEY`. (Mỗi shop còn có scoped key riêng do full sync tạo.)
- [ ] E2. Đặt CDN (Cloudflare) trước `search.<domain>`: tôn trọng Cache-Control, bật Cache-Tag; tạo API token quyền
      "Cache Purge" → `CDN_PURGE_URL`, `CDN_PURGE_TOKEN`.

## F. Giá theo market (D15) — cần dev store có Markets
- [ ] F1. (2.7a) Trên dev store có custom domain: trong console trang storefront chạy
      `fetch('/api/2026-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'{shop{name}}'})}).then(r=>r.status)`
      và lặp lại với `https://<store>.myshopify.com/api/2026-10/graphql.json` từ custom domain (kiểm tra CORS).
      Nếu same-origin chạy: đặt `"storefront":{"endpoint":"/api/2026-10/graphql.json"}` trong snippet `sa-config` (mặc định đang dùng myshopify — có tài liệu).
- [ ] F2. (2.7c) Gửi query giá với 48 ID thật, đọc `extensions.cost` (nếu có) → ghi vào Nhật ký; giữ ≤ 1.000 (tokenless).
- [ ] F3. (DoD 2.7) Tạo 3 market: USD gốc, EUR quy đổi tự động, VND có price list giá cố định. So giá trên kết quả search,
      collection và autocomplete với trang sản phẩm của theme (phải khớp 100%); DevTools → Network: đúng 1 request
      `graphql.json` mỗi lần tải trang kết quả; sản phẩm không publish ở market bị ẩn; filter giá chạy ở EUR.
- [ ] F4. (2.8) Bật flag `fixedMarketPrices` cho shop (Shop.features) → chạy full sync; xác nhận bulk variants chấp nhận alias
      `cp_VN: contextualPricing(context:{country: VN})` (nếu bulk báo lỗi field: chuyển pass này sang query phân trang
      thường theo lô 100 variant) và `price_min_vn` khớp giá trang sản phẩm khi xem từ VN.

## G. Theme extension trên dev store (Horizon)
- [ ] G1. `shopify app dev` → Theme editor → App embeds → bật "Search & Filter". Thêm block "Search results" vào template
      search và "Collection filters" vào template collection (deep link: `…/admin/themes/current/editor?template=search&addAppBlockId={client_id}/search-results&target=mainSection`).
      Kiểm tra: tắt JS → vẫn thấy kết quả native; bật lại → widget hydrate, filter/sort/phân trang đổi URL đúng kiểu `filter.p.*`.
- [ ] G2. Đổi app embed sang "Search API (CDN)" sau khi deploy search-api → xác nhận đọc được `app.metafields.searchapp.public_key`.

## H. Đa ngôn ngữ
- [ ] H1. Dev store có ngôn ngữ thứ hai (vi) + bản dịch (Translate & Adapt): chạy full sync → xác nhận bulk chấp nhận alias
      `tr_vi: translations(locale:"vi")` và tìm "áo thun" ở storefront `/vi/search` ra đúng sản phẩm; nhãn sort/filter tiếng Việt.
- [ ] H2. (2.13) Sau `shopify app deploy`: Settings → Customer events → xác nhận pixel "search-pixel" Connected. Dùng
      "Test pixel"/Pixel Helper: search → add to cart → checkout test → kiểm tra request `POST …/v1/events` và số liệu
      trong Analytics (rollup 10 phút/lần).
- [ ] G3. (DoD 2.14) Đo Lighthouse trên Horizon thật: cài theme Horizon sạch vào dev store, ghi điểm Home/Product/Collection
      khi TẮT app embed + block (baseline), rồi BẬT; mỗi trang ≥ 3 lần (median):
      `npx -y @lhci/cli@0.15 autorun --config=lighthouserc.json` (sửa URL REPLACE…). Tính giảm có trọng số
      Home 17% · Product 40% · Collection 43%, phải ≤ 5 (BFS ≤ 10). Ghi vào Nhật ký.
- [ ] C5. Bấm deep link "Bật app embed" ở Home trên dev store: nếu theme editor không tự bật embed với `activateAppId={client_id}/app-embed`,
      đặt env `SHOPIFY_SEARCH_THEME_ID` = giá trị `SHOPIFY_SEARCH_THEME_ID` trong `.env` do CLI sinh (uuid extension) và thử lại.

## I. Admin trên dev store
- [ ] I1. Mở app trong admin (cả giao diện admin mới `--feature-preview new_admin_design` và cũ): kiểm tra s-app-nav, Home
      (checklist đổi trạng thái sau khi bật embed/thêm block — shopify.app.extensions()), Sync, các trang cấu hình; thử trên mobile (Shopify app).
- [ ] I2. (DoD 3.2) Trang Search trên dev store: sửa trọng số → Save Bar hiện; "Thử tìm" đổi thứ hạng trước khi lưu; Discard
      khôi phục; thêm metafield → banner cảnh báo + sau khi lưu trang Sync có job FULL "schema-change". Bật tìm trang/bài viết
      → hộp thoại xin quyền read_online_store_pages.
- [ ] I3. (DoD 3.6) Trang Appearance: đổi màu/bo góc/số cột → preview bên cạnh đổi ngay; Lưu → storefront đổi ≤ 1 phút
      (CSS var trong /v1/config); thử template ghi đè thẻ sản phẩm trên Horizon.
- [ ] I4. (DoD 3.7) Trang Analytics sau vài lượt tìm thật (pixel + /v1/events): top query, query không có kết quả → nút
      "Thêm synonym" mở sẵn modal ở Merchandising; filter/sort usage có số liệu sau rollup (≤ 10 phút).
- [ ] I5. (3.8) Publish `docs/developers` (GitHub Pages/Docs site) rồi đặt `DEVELOPER_DOCS_URL`. Kiểm tra trên shop gói Pro:
      bật "Allow headless requests" → gọi `/v1/search` từ origin khác trả 200; tắt → 403 `headless_disabled`.
