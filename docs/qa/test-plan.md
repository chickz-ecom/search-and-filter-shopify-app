# Tài liệu kiểm thử: Search & Filter (Shopify app)

Phiên bản: 2026-10-26. Dùng cho tester kiểm thử thủ công trước khi phát hành (và kiểm thử lại sau mỗi bản sửa lớn).
https://claude.ai/artifact/Pu9LCGQRivgbXsNMjFbL3B

## 1. Cách dùng tài liệu này

- Mỗi kịch bản có **mã** (ví dụ `SY-03`), **mức ưu tiên** và **kết quả mong đợi**.
  - **P1**: chặn phát hành. Hỏng là không được release.
  - **P2**: quan trọng. Phải sửa trước release hoặc có xác nhận chấp nhận rủi ro.
  - **P3**: nên có. Ghi nhận và sửa sau.
- Copy các bảng sang Google Sheet và thêm 3 cột: **Kết quả** (Pass / Fail / Blocked / N/A), **Thiết bị/trình duyệt**, **Link bug**.
- Khi một kịch bản hỏng, báo lỗi theo mẫu ở [mục 7](#7-mẫu-báo-lỗi).
- Mục [6. Lỗi đã biết](#6-lỗi-đã-biết-chưa-sửa) liệt kê các lỗi đã ghi nhận nhưng chưa sửa. Gặp đúng các lỗi này thì ghi mã lỗi (`KB-xx`), không cần báo lại.
- Nhãn nút và tiêu đề trong tài liệu ghi đúng như trên giao diện **tiếng Anh**. Admin chuyển sang tiếng Việt khi thêm `?locale=vi` vào URL.

## 2. Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Admin trong Shopify: Home, Search, Sorting, Filters, Merchandising, Appearance, Analytics, Sync, Developers, Plans, Help | Kiểm thử tải (load test), chịu lỗi cụm Typesense |
| Storefront: ô search gợi ý (app embed), trang kết quả search, trang collection, bộ lọc, sắp xếp, phân trang | API headless gọi trực tiếp (chỉ kiểm thử sơ qua ở `DV-`) |
| Đồng bộ sản phẩm: sync toàn bộ, cập nhật tự động, reindex, tiến độ | Billing thật (chỉ dùng test charge trên dev store) |
| Đa thị trường, đa ngôn ngữ, mobile, khả năng truy cập (a11y), hiệu năng cơ bản | |

## 3. Chuẩn bị môi trường

### 3.1. Store và theme

- Dev store đã cài app. Storefront có mật khẩu: nhập mật khẩu storefront trước khi test.
- Test trên **ít nhất 2 theme**: theme đang dùng (Shrine) và một theme chuẩn của Shopify (Dawn hoặc Horizon).
- Trong **Online Store → Themes → Customize**:
  1. **App embeds**: bật "Search & Filter", bấm Save.
  2. Template **Search**: Add section → Apps → **"Search results"**. Ẩn section kết quả search có sẵn của theme.
  3. Template **Collections → Default collection**: Add section → Apps → **"Collection filters"**. Ẩn section "Product grid" có sẵn của theme.
  4. Bấm Save.

### 3.2. Dữ liệu mẫu cần có trên store

| Dữ liệu | Dùng cho |
|---|---|
| ≥ 50 sản phẩm **Active** và đã publish lên **Online Store** | hầu hết kịch bản |
| Sản phẩm có variant **Color** (Red, Blue…) và **Size** (S, M, L) | filter option, swatch |
| Sản phẩm đang giảm giá (có compare-at price) | badge Sale, filter On sale |
| Sản phẩm hết hàng (tồn kho 0, không cho bán khi hết) | badge Sold out, Availability |
| 1 sản phẩm **Draft**, 1 sản phẩm **Archived**, 1 sản phẩm Active nhưng **chưa publish** Online Store | `SY-12` (không được xuất hiện) |
| ≥ 1 collection **thủ công** (sắp xếp thủ công) và ≥ 1 collection **tự động** | trang collection, sort Featured |
| Tag dạng `color:Red`, `material:Wool` | filter tag có tiền tố |
| 1 metafield sản phẩm kiểu số, ví dụ `custom.rating`, đã có giá trị trên vài sản phẩm | filter/sort/search theo metafield |
| Ngôn ngữ thứ 2 đã publish (ví dụ Vietnamese) và có bản dịch sản phẩm | `MK-` |
| Market thứ 2 với tiền tệ khác (ví dụ EUR) | `MK-`, `PR-08` |
| ≥ 1 trang (Page) và ≥ 1 bài blog | tìm kiếm trang/bài viết |
| Một sản phẩm giá rất cao, ví dụ $1.000.000 (sản phẩm tiện ích) | `PR-` (thanh trượt với khoảng giá lệch) |

### 3.3. Thiết bị và trình duyệt

| Loại | Bắt buộc | Nên có |
|---|---|---|
| Desktop | Chrome mới nhất (1280–1440px) | Safari macOS, Firefox, Edge |
| Mobile | iPhone Safari (iOS 17+), Android Chrome | iPad (768px) |

Với kịch bản responsive, dùng DevTools → Toggle device toolbar ở các bề ngang **390**, **768** và **1280**.

### 3.4. Môi trường chạy local (chỉ khi test trên máy dev)

Cần đủ 5 tiến trình, thiếu một cái là lỗi.

| Thành phần | Lệnh hoặc container | Thiếu thì sao |
|---|---|---|
| Postgres | container `postgres_db` | admin lỗi |
| Redis | container `docker-redis-1` | admin trắng hoặc treo, sync không chạy |
| Typesense | `docker compose up -d` | search lỗi (storefront hiện lưới gốc), sync FAILED |
| Worker | `npm run worker` | sync đứng ở "Queued" |
| App và tunnel | `npm run dev` (tunnel `search.tiepdo.online`) | admin không mở được, storefront không gọi được API |

### 3.5. Công cụ hỗ trợ

- **DevTools → Network**:
  - Lọc `apps/search` để xem request của app. Bình thường status là **200**.
  - Throttling **Slow 4G** hoặc **3G** để thấy skeleton.
- **DevTools → Console**: không được có lỗi đỏ do `searchapp-*.js` gây ra.
- **Lighthouse** (Chrome) cho kịch bản hiệu năng.
- Thời gian các job nền:

  | Việc | Thời gian |
  |---|---|
  | Webhook cập nhật sản phẩm | vài giây đến khoảng 1 phút |
  | Quét bù thay đổi bị lỡ | mỗi 1–5 phút |
  | Tổng hợp Analytics | mỗi 10 phút |
  | Đối soát và best-selling (job đêm) | 03:00 UTC (10:00 giờ Việt Nam) |

## 4. Smoke test (≈ 15 phút, chạy đầu tiên mỗi bản build)

| Mã | Kịch bản | Mong đợi |
|---|---|---|
| SM-01 | Mở app trong admin | Trang Home hiện, không trắng, không lỗi |
| SM-02 | Trang **Sync** → bấm **Sync from Shopify** | Lần lượt chạy các giai đoạn đến "Up to date". Không có lỗi "Bad Request" |
| SM-03 | Storefront: gõ "sh" vào ô search của theme | Dropdown gợi ý của app hiện ra |
| SM-04 | Mở `/search?q=a` | Có cột filter, ô sort, lưới sản phẩm. Network `apps/search/...` trả 200 |
| SM-05 | Mở một trang collection | Như SM-04, số sản phẩm đúng với collection |
| SM-06 | Chọn 1 filter rồi đổi sort | Kết quả và URL đổi theo |
| SM-07 | Mobile 390px: bấm **Filters** | Bottom sheet mở. Bấm **Show N products** thì đóng |

## 5. Kịch bản chi tiết

### 5.1. Cài đặt và Home (`ON`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| ON-01 | P1 | Cài lần đầu | Cài app trên store mới → mở app | Home hiện. Card **Catalog sync** tự chạy Queued → Syncing → Up to date mà không cần thao tác |
| ON-02 | P1 | Trạng thái app embed | 1) Tắt embed trong theme rồi mở Home<br>2) Bấm **Open theme editor** ở bước "Turn on the app embed"<br>3) Bật embed, Save, quay lại Home rồi reload | 1) Badge "App embed is off"<br>2) Mở tab mới, thấy mục App embeds<br>3) "App embed is on", bước 1 có badge **Done** |
| ON-03 | P2 | Thêm block từ Home | Bấm **Add block** ở bước 2 (collection) và bước 3 (search) | Theme editor mở đúng template. Thêm block, Save, reload Home thì bước đó **Done**. Nếu deep link không tự thêm được block, ghi rõ tên theme |
| ON-04 | P2 | Bước 4–6 | Save một thay đổi bất kỳ ở Search, Sorting, Filters | Bước tương ứng thành **Done** |
| ON-05 | P3 | Bước 7 | Bấm **Open storefront** | Mở `/search?q=` ở tab mới. Bước 7 **Done** |
| ON-06 | P2 | Nút chính của trang | Quan sát nút chính trên đầu trang Home | Mang tên bước đầu tiên chưa xong. Ẩn khi đã xong hết |
| ON-07 | P3 | Ẩn hướng dẫn | Bấm **Dismiss guide** | Mục Setup guide biến mất, kể cả sau khi reload |
| ON-08 | P2 | KPI 7 ngày | Store chưa có lượt search nào → thực hiện vài lượt search, đợi ≥ 10 phút | Trước: "Search analytics appear here once shoppers start searching." Sau: các ô Searches, No-result searches, Click-through rate, Revenue after search có số |
| ON-09 | P1 | Sync tự cập nhật trên Home | Bấm Sync ở trang Sync rồi quay về Home | Card sync tự đổi trạng thái và % mà không cần reload |
| ON-10 | P2 | Banner lỗi sync | (Môi trường dev) tắt Typesense rồi Sync | Home hiện banner đỏ "The last sync failed" và link **View sync details** |

### 5.2. Đồng bộ sản phẩm: trang Sync (`SY`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| SY-01 | P1 | Sync from Shopify | Bấm **Sync from Shopify** | Toast "Full sync queued".<br>Dòng trạng thái ghi giai đoạn kèm **% của cả lượt**: "Preparing" → "Downloading data from Shopify · x% overall" → "Saving to the search index · x% overall" → "Switching search to the new data · x% overall" → "Up to date".<br>Dưới thanh có danh sách bước, mỗi bước có badge Waiting / In progress / Done: **Products** (a/b, a tăng tới tổng số sản phẩm), **Variants and prices** (số biến thể), **Collections**, **Save to the search index** (a/b), **Switch search to the new data**. Ba bước tải có thể chạy song song.<br>Thanh tiến độ tăng dần, không đứng 0% rồi nhảy 100%. Lịch sử có dòng **Full sync / Succeeded** và số đã import |
| SY-02 | P1 | Không cần reload | Giữ nguyên trang trong lúc sync | Trạng thái và % tự cập nhật khoảng 1,5 giây/lần |
| SY-03 | P1 | Chặn bấm trùng | Bấm Sync, rồi bấm tiếp Sync hoặc Reindex khi đang Queued hoặc Syncing | Cả 2 nút bị khoá (disabled). Nếu kịp bấm lần nữa: toast "A sync is already running" |
| SY-04 | P1 | Reindex | Bấm **Reindex** | Toast "Reindex queued". Dòng trạng thái "Rebuilding the search index · x% overall", **không** có bước tải từ Shopify. Danh sách bước chỉ gồm **Rebuild the search index** (a/b) và **Switch search to the new data**. Xong thì "Up to date", lịch sử có dòng **Reindex / Succeeded**, số sản phẩm không đổi. Storefront search vẫn chạy bình thường trong lúc reindex |
| SY-05 | P2 | Mô tả 2 nút | Đọc phần Status | Có đoạn giải thích: Sync from Shopify tải lại từ Shopify, Reindex dựng lại từ dữ liệu đã đồng bộ và **không** lấy sản phẩm mới |
| SY-06 | P1 | Sản phẩm mới tự lên | Tạo sản phẩm mới (Active, publish Online Store), **không** bấm Sync | Trong khoảng 1 phút, tìm theo tên trên storefront là thấy. "Last change synced" cập nhật |
| SY-07 | P1 | Sửa sản phẩm | Đổi title, giá, tag của 1 sản phẩm | Storefront phản ánh thay đổi trong khoảng 1 phút |
| SY-08 | P1 | Gỡ sản phẩm | Lần lượt: xoá 1 sản phẩm / chuyển 1 sản phẩm sang Draft / bỏ publish Online Store | Sản phẩm biến mất khỏi search và collection trong khoảng 1 phút |
| SY-09 | P2 | Tồn kho | Đặt tồn kho một sản phẩm về 0 | Số đếm "In stock" giảm. Với setting "Show at the end", sản phẩm xuống cuối danh sách |
| SY-10 | P2 | Collection thủ công | Thêm hoặc bớt sản phẩm, đổi thứ tự trong collection thủ công | Trang collection (sort Featured) phản ánh đúng trong vài phút |
| SY-11 | P2 | Collection mới | Tạo collection mới, publish | Xuất hiện trong nhóm "Collections" của dropdown gợi ý |
| SY-12 | P1 | Không index sản phẩm ẩn | Search đúng tên các sản phẩm Draft, Archived, chưa publish | Không xuất hiện ở bất kỳ đâu trên storefront |
| SY-13 | P2 | Engine tắt (dev) | Tắt Typesense → bấm Sync → bật lại → Sync | Job **Failed**, badge "Needs attention", banner hướng dẫn. **Không** treo mãi ở "Syncing". Bật lại thì Sync thành công |
| SY-14 | P3 | Worker tắt (dev) | Tắt worker → bấm Sync → bật worker | Hiện "Queued: waiting for the sync worker to start". Bật worker thì sync tự chạy |
| SY-15 | P3 | Lịch sử | Xem bảng History | Các cột Type, Status, Started, Duration, Result đúng. Tối đa 20 dòng |

### 5.3. Ô search gợi ý: instant search (`IS`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| IS-01 | P1 | Hiện gợi ý | Gõ 1 ký tự, rồi gõ thêm ký tự thứ 2 | 1 ký tự: không hiện gì. Từ 2 ký tự: dropdown hiện nhanh (< 0,5s) với các nhóm Suggestions, Products (tối đa 6), Collections, Pages |
| IS-02 | P1 | Mở sản phẩm | Bấm một sản phẩm trong dropdown | Mở đúng trang sản phẩm |
| IS-03 | P1 | Xem tất cả | Từ khoá có nhiều kết quả → bấm "View all N results" | Mở `/search?q=…` với cùng số kết quả |
| IS-04 | P1 | Bàn phím | ↓/↑ để di chuyển, Enter, Esc | Mục được chọn có highlight. Enter mở mục đang chọn. Enter khi chưa chọn gì thì submit form search của theme. Esc đóng dropdown |
| IS-05 | P2 | Không có kết quả | Gõ "zzzxxq" | Dòng "No results for “zzzxxq”" |
| IS-06 | P2 | Gõ sai chính tả | Gõ "shrit" thay vì "shirt" | Vẫn ra sản phẩm "shirt" (Typo tolerance = Normal) |
| IS-07 | P2 | Các trường search | Search theo SKU, vendor, tag, màu (Red), tên variant | Đều tìm thấy (theo cấu hình mặc định ở trang Search) |
| IS-08 | P2 | Gõ dở từ | Gõ "swea" | Ra "Sweater" |
| IS-09 | P2 | Đóng dropdown | Bấm ra ngoài | Dropdown đóng |
| IS-10 | P2 | Mobile | Thực hiện IS-01 trên điện thoại | Dropdown nằm đúng dưới ô search, cuộn được, chạm vào chọn được |
| IS-11 | P3 | Trùng dropdown của theme | Theme có predictive search riêng | Ghi nhận nếu 2 dropdown chồng lên nhau (kèm tên theme) |

### 5.4. Trang kết quả search (`SR`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| SR-01 | P1 | Hiển thị | Mở `/search?q=shirt` | Có "N results", ô sort, cột filter, lưới thẻ sản phẩm (ảnh, vendor, tên, giá, badge Sale hoặc Sold out) |
| SR-02 | P1 | Skeleton khi tải | Network Slow 4G → mở lại trang | Thấy khung xám nhấp nháy cho số kết quả, nút sort, cột filter và lưới. Không thấy lưới gốc của theme hiện ra rồi bị thay. Khi xong không bị giật layout |
| SR-03 | P1 | Phân trang | Bấm trang 2 → bấm Back | URL có `page=2`, trang cuộn lên đầu khối kết quả. Back thì về trang 1 |
| SR-04 | P1 | Chia sẻ URL | Chọn filter, sort, sang trang 2 → copy URL → mở ở tab ẩn danh | Trạng thái giống hệt |
| SR-05 | P2 | Không có kết quả | `/search?q=zzzxxq` | Tiêu đề "No results for “zzzxxq”" và gợi ý |
| SR-06 | P2 | Redirect | Tạo redirect ở Merchandising (`MR-04`) → search đúng từ khoá đó | Chuyển thẳng tới trang đích |
| SR-07 | P2 | Hiểu câu search | Bật "Turn words into filters" (trang Search) → search "red nike" | Có chip filter (Red, Nike) và dòng "Showing results with filters from your search." Bấm "Search for “red nike” instead" thì search nguyên cụm |
| SR-08 | P2 | Sản phẩm hết hàng | Lần lượt chọn Show normally / Show at the end / Hide (trang Search) | Sản phẩm hết hàng: xen kẽ bình thường / nằm cuối / không hiện |
| SR-09 | P2 | Loại theo tag | Trang Search → "Hide products with these tags" = `hidden` → gắn tag cho 1 sản phẩm | Sản phẩm đó không xuất hiện |

### 5.5. Trang collection (`CO`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| CO-01 | P1 | Hiển thị | Mở `/collections/<handle>` | Đúng sản phẩm và số lượng của collection. Có filter và sort |
| CO-02 | P1 | Sort mặc định | Collection thủ công | Mặc định "Featured", đúng thứ tự đã kéo thả trong Shopify |
| CO-03 | P2 | Override sort | Sorting → Collection overrides → chọn collection, sort "Price, low to high" → Save | Collection đó mặc định sắp theo giá tăng dần. Collection khác không đổi |
| CO-04 | P2 | Override filter | Filters → Add collection override → bớt 1 filter → Save | Chỉ collection đó mất filter. Collection khác giữ nguyên |
| CO-05 | P2 | Ghim và ẩn | Tạo rule cho collection: ghim SP A ở vị trí 1, ẩn SP B (`MR-06`) | A đứng đầu, B không hiện |

### 5.6. Bộ lọc trên desktop (`FD`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| FD-01 | P1 | Accordion | Bấm tiêu đề từng filter | Thu gọn hoặc mở ra, chevron xoay theo. Mặc định mở, trừ filter đặt "Collapsed by default" |
| FD-02 | P1 | Chọn giá trị | Tick "Nike" ở Brand | Kết quả lọc lại. URL có `filter.p.vendor=Nike`. Có chip "Nike ×". Tiêu đề Brand có badge **1** |
| FD-03 | P1 | Logic lọc | Tick 2 brand, rồi thêm 1 size | Trong cùng filter là HOẶC (OR), khác filter là VÀ (AND). Số đếm (n) cạnh các giá trị của filter đang chọn không về 0 |
| FD-04 | P1 | Bỏ lọc | Bấm "×" trên chip, rồi bấm "Clear all" | Bỏ đúng giá trị đó, rồi bỏ tất cả |
| FD-05 | P2 | Giữ trạng thái accordion | Đóng Product type → tick một giá trị ở Brand | Product type vẫn đóng sau khi lưới tải lại |
| FD-06 | P1 | Sticky | Trang có nhiều sản phẩm → cuộn xuống | Cột filter dính trên đầu, **không bị header của theme che**. Cột dài hơn màn hình thì cuộn riêng. Tick giá trị ở cuối cột thì cột không nhảy về đầu |
| FD-07 | P2 | Trạng thái đang tải | Throttle Slow 4G → tick filter | Lưới mờ đi, có thanh chạy phía trên. Cột filter vẫn bấm được |
| FD-08 | P2 | Back/Forward | Chọn 2 filter → Back → Forward | Filter khôi phục đúng từng bước |
| FD-09 | P2 | Kiểu hiển thị | Tạo filter Color dạng swatch, Availability dạng toggle, một filter Single choice | Swatch có chấm màu. Toggle là ô "In stock". Single choice chỉ chọn được 1 giá trị |
| FD-10 | P2 | Vị trí Top | Theme editor → block → Filter position = **Top** | Filter thành hàng nút ngang. Bấm thì mở dropdown, mở cái này thì cái kia đóng, bấm ra ngoài thì đóng |
| FD-11 | P3 | Vị trí None | Filter position = **None** | Không có filter của app |
| FD-12 | P3 | Khớp tất cả | Filter Tag bật "Products must match all selected values" → chọn 2 tag | Chỉ ra sản phẩm có **cả hai** tag |

### 5.7. Bộ lọc trên mobile (`FM`, bề ngang < 750px)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| FM-01 | P1 | Toolbar | Mở trang search hoặc collection | "N results" nằm một dòng riêng. Dòng dưới: nút **Filters** bên trái, Sort bên phải. Không thấy cột filter |
| FM-02 | P1 | Mở sheet | Bấm **Filters** | Sheet trượt từ dưới lên, bo góc trên, có tiêu đề "Filters" và nút ×. Nền phía sau mờ và **không cuộn được** |
| FM-03 | P1 | Chọn trong sheet | Mở Brand → tick 1 giá trị | Các accordion đóng sẵn, trừ filter đang có lựa chọn. Nút "Show N products" đổi số ngay |
| FM-04 | P1 | Xem kết quả | Bấm **Show N products** | Sheet đóng, lưới đã lọc, số kết quả bằng N |
| FM-05 | P1 | Đóng sheet | Đóng lần lượt bằng ×, chạm vào nền mờ, phím Esc (bàn phím ngoài) | Đều đóng. Trang cuộn lại được |
| FM-06 | P1 | Reset | Có filter → mở sheet → **Reset filters** | Bỏ hết filter. Nút Reset mờ đi (disabled) khi chưa chọn gì |
| FM-07 | P2 | Badge | Chọn 2 giá trị | Nút Filters có badge **2** |
| FM-08 | P2 | Danh sách dài | Mở filter nhiều giá trị, cuộn xuống cuối, tick | Sheet cuộn được. Nút Show và Reset luôn ở đáy. Tick xong không nhảy về đầu |
| FM-09 | P2 | Đổi cỡ màn hình | Sheet đang mở → xoay ngang hoặc kéo cửa sổ lên > 750px | Sheet đóng, layout chuyển sang cột filter desktop, trang cuộn bình thường |
| FM-10 | P2 | iPhone | Test trên iPhone thật | Nút Show và Reset không bị thanh home che. Thanh địa chỉ co giãn không làm vỡ sheet |
| FM-11 | P3 | Vị trí Drawer | Filter position = **Drawer**, xem trên desktop | Desktop cũng có nút Filters, panel trượt từ trái |

### 5.8. Thanh trượt giá (`PR`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| PR-01 | P1 | Giao diện | Xem filter Price | Thanh trượt 2 đầu, **không có ô nhập tay**. Dưới thanh: giá thấp nhất bên trái, cao nhất bên phải, có ký hiệu tiền tệ (ví dụ "$17", "$1,000,000") |
| PR-02 | P1 | Kéo và lọc | Kéo đầu phải sang trái rồi thả | Nhãn chạy theo khi kéo. Thả tay thì lưới lọc lại, URL có `filter.v.price.lte=…` |
| PR-03 | P1 | Không vượt nhau | Kéo đầu trái vượt quá đầu phải | Hai đầu dừng tại nhau. Kéo cả hai về cùng một điểm vẫn tách ra được |
| PR-04 | P1 | Khoảng giá giữ nguyên | Sau PR-02, xem lại thanh | Hai mút vẫn là khoảng ban đầu, không co lại theo kết quả |
| PR-05 | P2 | Bỏ lọc | Kéo đầu về hết mép | Phía đó bỏ lọc, URL không còn `gte` hoặc `lte` |
| PR-06 | P2 | Bàn phím | Tab tới đầu kéo → nhấn → 5 lần liên tiếp | Chỉ tải lại 1 lần (sau khoảng 0,3s). Sau khi tải xong, focus vẫn ở đầu kéo |
| PR-07 | P2 | Chip | Đang lọc giá | Có chip "Price: $20–$90". Bấm × thì bỏ |
| PR-08 | P2 | Tiền tệ khác | Đổi market sang EUR | Nhãn hiện €. Lọc theo giá € đúng với giá hiển thị trên thẻ |
| PR-09 | P2 | Mobile | Kéo bằng ngón tay trong sheet | Mượt, không kéo nhầm thành cuộn sheet |

### 5.9. Sắp xếp trên storefront (`SO`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| SO-01 | P1 | Danh sách option | Mở dropdown Sort | Đúng các option đang bật ở admin, đúng thứ tự và tên đã đổi. Trang search có "Relevance", không có "Featured". Trang collection thì ngược lại |
| SO-02 | P1 | Thứ tự đúng | Lần lượt chọn từng option | Giá tăng / giảm, mới nhất, A–Z… sắp đúng. "Best selling" theo dữ liệu bán hàng |
| SO-03 | P2 | URL | Chọn sort → Back | URL có `sort_by=…`. Back khôi phục |
| SO-04 | P2 | Mặc định | Đổi "Default sort" ở admin → Save | Storefront dùng sort mới khi mở trang không có `sort_by` |
| SO-05 | P3 | Sort theo metafield | Thêm metafield sort (`ASO-07`) | Có trên dropdown và sắp đúng |

### 5.10. Lỗi, dự phòng, store có mật khẩu (`FB`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| FB-01 | P1 | API lỗi | (dev) Tắt Typesense, hoặc DevTools → Network → chặn `apps/search` → mở trang search | Skeleton biến mất, **lưới gốc của Shopify vẫn hiện**. Không có lỗi đỏ trong Console |
| FB-02 | P2 | JavaScript bị chặn | DevTools → Disable JavaScript → mở trang search | Trong ≤ 5 giây skeleton biến mất, lưới gốc hiện |
| FB-03 | P1 | Store có mật khẩu | Nhập mật khẩu storefront → mở trang search → xem Network | Request `/apps/search/v1/...` trả **200**, **không** phải 302 về `/password` |
| FB-04 | P2 | Giá theo market lỗi | Chặn request `graphql.json` (Storefront API) với market tiền tệ khác | Thẻ hiện "View price", **không** hiện giá sai tiền tệ |

### 5.11. Admin: trang Search (`AS`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| AS-01 | P1 | Save bar | Đổi một setting bất kỳ | Thanh Save / Discard hiện. Discard hỏi xác nhận rồi trả về giá trị cũ. Save thì toast "Saved", thanh biến mất |
| AS-02 | P1 | Trọng số | Ô "Try a search" gõ một từ → đổi weight hoặc tắt "Search in" của Title | Kết quả xem thử đổi ngay (chưa cần Save). Có badge "Matched in". Save xong storefront đổi theo, **không** kích hoạt sync |
| AS-03 | P2 | Validation | Tắt hết các field. Đặt "Minimum word length for 2 typos" nhỏ hơn mức cho 1 typo | "Enable at least one search field" / "Must be greater than or equal to the 1-typo length". Không lưu được |
| AS-04 | P2 | Thêm metafield | Add metafield → chọn `custom.rating` → Save | Hiện banner cần re-sync. Toast "Saved. A full re-sync has started…". Trang Sync có full sync mới chạy |
| AS-05 | P2 | Mức sửa lỗi gõ | Level = Off → search "shrit" | Không ra "shirt". Đặt lại Normal thì ra |
| AS-06 | P2 | Ranking | Đổi "How fields combine", "When relevance is equal", "Rank exact matches first" | Thứ tự trong "Try a search" thay đổi hợp lý |
| AS-07 | P2 | Trang và bài viết | What to search → bật Pages và Blog posts → Save | Shopify hỏi cấp quyền đọc trang. Đồng ý thì trang và bài viết xuất hiện trong dropdown gợi ý. Từ chối thì setting vẫn lưu nhưng không có trang (xem `KB-02`) |
| AS-08 | P2 | Loại theo tag | Xem `SR-09` | |
| AS-09 | P2 | Mặc định | **Restore defaults** → Save | Các giá trị về mặc định |
| AS-10 | P1 | AI search | Shop gói **Pro** trở lên → bật "Match by meaning" → Save | Bật được, toast có re-sync. Search theo nghĩa ("winter clothes" ra áo len). **Hiện đang lỗi, xem `KB-01`** |

### 5.12. Admin: trang Filters (`AF`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| AF-01 | P1 | Thêm filter | **Add filter** → Filter by "Variant option", Option name "Color", Display "Color swatches" → **Add filter** → Save | Danh sách có dòng mới. Storefront có filter Color dạng swatch |
| AF-02 | P1 | Ẩn và hiện | Tắt công tắc của Brand → Save | Dòng có badge "Hidden". Storefront mất Brand. Bật lại thì có |
| AF-03 | P1 | Đổi thứ tự | Dùng ↑/↓ → Save | Thứ tự trên storefront đổi theo |
| AF-04 | P1 | Kiểu hiển thị theo nguồn | Đổi "Filter by" lần lượt qua các nguồn | Price chỉ có Range. Availability và On sale chỉ có Toggle. Metafield kiểu số có Range, Checkboxes, Single choice. Option và Tag có thêm Color swatches |
| AF-05 | P2 | Validation | Thêm Variant option nhưng bỏ trống Option name → Save | Banner "Could not save": "\<tên\>: Option name is required". Dòng đó có badge "Needs attention" |
| AF-06 | P2 | Phạm vi (scope) | Editing → "Search page" → **Customize for search** → bớt 1 filter → Save. Sau đó **Use default filters** | Trang search có bộ filter riêng. Bấm Use default thì trở lại như mặc định |
| AF-07 | P2 | Bản dịch | Edit filter → Translations → nhập nhãn cho ngôn ngữ 2 → Save | Storefront ở ngôn ngữ 2 hiện nhãn đã dịch |
| AF-08 | P2 | Giới hạn giá trị | "Values shown" = 3, "Order values by" = Alphabetical | Storefront hiện tối đa 3 giá trị, xếp theo A–Z |
| AF-09 | P2 | Thu gọn sẵn | Tick "Collapsed by default" → Save | Accordion của filter đó đóng sẵn trên desktop |
| AF-10 | P2 | Tag có tiền tố | Filter by Tag, "Only tags starting with" = `color:` | Storefront hiện "Red", không phải "color:Red" |
| AF-11 | P2 | Metafield mới cần sync | Thêm filter Metafield trên một metafield chưa dùng ở đâu → Save | Toast có re-sync. Sau khi sync xong filter có giá trị |
| AF-12 | P3 | Xoá filter | Bấm icon thùng rác | Dòng bị xoá ngay, **không** hỏi xác nhận (xem `KB-11`). Discard thì lấy lại được |

### 5.13. Admin: trang Sorting (`ASO`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| ASO-01 | P1 | Bật và tắt | Tắt "Price, high to low" → Save | Storefront không còn option đó |
| ASO-02 | P1 | Đổi thứ tự | Kéo thả, hoặc dùng ↑/↓ → Save | Thứ tự trên storefront đổi theo |
| ASO-03 | P2 | Đổi tên | **Rename** → "Giá thấp trước" + bản dịch → Done → Save | Storefront hiện tên mới. Admin hiện "Sorts by: Price, low to high". Xoá trống tên thì quay về tên gốc |
| ASO-04 | P2 | Validation | Tắt hết option. Tắt option đang là Default sort | "Enable at least one sort option" / "The default sort must be enabled" |
| ASO-05 | P2 | Collection override | Xem `CO-03`. Bấm Remove trên một override | Collection đó quay về sort mặc định |
| ASO-06 | P2 | Best selling chưa có dữ liệu | Store mới, chưa có đơn | Best selling có badge "Needs sales data", công tắc bị khoá (xem `KB-07`) |
| ASO-07 | P3 | Sort theo metafield | Add a metafield sort → `custom.rating`, "High to low" → Add → Save | Có option mới. Có thể kích hoạt re-sync |
| ASO-08 | P2 | Xếp hạng theo đơn hàng | **Rank by orders from the last 60 days** → đồng ý cấp quyền đọc đơn | Toast "Order ranking turned on. Importing orders…". Sau một lúc: "Last updated … from N orders" |
| ASO-09 | P2 | Từ chối quyền | Như ASO-08 nhưng từ chối | Toast lỗi "Permission to read orders wasn't granted" |
| ASO-10 | P3 | Quay lại xếp hạng của Shopify | **Switch back to Shopify's ranking** | Toast "Back to Shopify's ranking. Order data deleted." |

### 5.14. Admin: Merchandising (`MR`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| MR-01 | P1 | Từ đồng nghĩa hai chiều | Synonyms → Add → Two-way → "sweater, jumper" → Save | Search "jumper" ra sweater và ngược lại. Áp dụng ngay, không cần sync |
| MR-02 | P2 | Từ đồng nghĩa một chiều | One-way: "tee" → "t-shirt" | Search "tee" ra t-shirt. Search "t-shirt" **không** ra kết quả của "tee" |
| MR-03 | P2 | Validation synonym | Two-way chỉ nhập 1 từ. One-way bỏ trống từ gốc | "Add at least two words" / "Enter the search term" |
| MR-04 | P1 | Redirect | Redirects → "returns" → `/pages/returns` | Search "returns" hoặc "RETURNS" thì chuyển tới trang đích |
| MR-05 | P2 | Validation redirect | Nhập `https://google.com`, `//evil.com`, `javascript:alert(1)`. Tạo trùng từ khoá | "Use a path on your store, like /collections/sale" / "A redirect for this search already exists" |
| MR-06 | P1 | Rule ghim và ẩn | Rules → Add → "Shoppers search for" "shirt", Match Exactly → ghim SP A ở Position 1, ẩn SP B → Save | Search "shirt": A đứng đầu, B không có. Search "shirts" (Exactly) thì không áp dụng |
| MR-07 | P2 | Đẩy lên và dìm xuống | Add boost: Vendor = Nike, Weight 10. Thử thêm Weight −10 | Sản phẩm Nike lên đầu / xuống cuối (trong cùng mức liên quan) |
| MR-08 | P2 | Thời gian hiệu lực | Starts là ngày mai | Hôm nay rule chưa áp dụng |
| MR-09 | P2 | Tắt rule | Tắt "Active" | Rule không áp dụng. Danh sách có badge "Disabled" |
| MR-10 | P2 | Xoá | Delete | Có hộp xác nhận "Delete this item?". Xoá thì có hiệu lực ngay trên storefront |
| MR-11 | P3 | Stop words | Thêm stop word "the" | Search "the shirt" cho kết quả như "shirt" |

### 5.15. Admin: Appearance (`AP`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| AP-01 | P1 | Màu sắc | Accent = `#e11d48` → Save | Storefront: nút "Show N products", badge số đếm, thanh trượt, trang hiện tại trong phân trang đổi màu. Preview đổi ngay |
| AP-02 | P2 | Validation màu | Nhập `red` hoặc `#12` | "Use a hex color like #1a1a1a" |
| AP-03 | P2 | Bố cục | Corner radius 0, Spacing 32, tắt Show vendor → Save | Storefront đổi theo: thẻ vuông góc, khoảng cách rộng hơn, không còn vendor. Số cột lấy theo setting "Columns" của block trong theme editor (xem `KB-12`) |
| AP-04 | P1 | Văn bản | Đổi "Filters heading", "Show products button…" = "Xem {n} món", "Reset filters button" | Sheet mobile hiện chữ mới, `{n}` được thay bằng số |
| AP-05 | P2 | Theo ngôn ngữ | Language = ngôn ngữ 2 → nhập text → Save | Storefront ngôn ngữ 2 dùng text đó. Ngôn ngữ chính không đổi |
| AP-06 | P1 | Template an toàn | Product card: chèn `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<a href="javascript:alert(1)">` | Không lưu được, mỗi trường hợp có thông báo lỗi tương ứng |
| AP-07 | P2 | Template hợp lệ | Thêm `<p class="x">{{ title }}</p>` vào Product card | Preview và storefront hiện theo template mới. Xoá trống thì về template gốc |

### 5.16. Admin: Analytics (`AN`)

Cần có lượt search thật trên storefront. Dữ liệu cập nhật khoảng 10 phút một lần.

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| AN-01 | P1 | Số liệu tổng | Search 10 lần (có 2 lần không kết quả), click 3 sản phẩm → đợi 10 phút | Searches, No-result searches, Click-through rate khớp tương đối |
| AN-02 | P2 | Add to cart và doanh thu | Search → mở sản phẩm → thêm vào giỏ → thanh toán bằng cổng test (Bogus Gateway) trong vòng 30 phút sau khi search | Add to carts và Revenue after search tăng. Không tăng thì kiểm tra web pixel của app đã bật chưa (Settings → Customer events) |
| AN-03 | P2 | Khoảng thời gian | Đổi Date range 7, 30, 90 ngày | URL có `?range=`, số liệu đổi theo |
| AN-04 | P2 | Không có kết quả → xử lý | Ở "Searches with no results" bấm **Add redirect** / **Add synonym** | Mở Merchandising với từ khoá điền sẵn (xem `KB-06` cho synonym) |
| AN-05 | P3 | Gợi ý synonym | Có search sai chính tả hoặc thiếu dấu không ra kết quả | "Suggested synonyms" có gợi ý. Add synonym thì toast "Synonym added". Dismiss thì ẩn |
| AN-06 | P3 | Dùng filter và sort | Dùng vài filter và sort trên storefront | Bảng "Filter usage" / "Sort usage" có số liệu |

### 5.17. Admin: Plans, Developers, Help (`PL`, `DV`, `HP`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| PL-01 | P2 | Gói hiện tại | Mở Plans | Tên gói, giá, "N of M products" kèm thanh. Catalog vượt giới hạn thì có banner gợi ý gói phù hợp |
| PL-02 | P2 | Đổi gói | **Change plan** | Mở trang chọn gói của Shopify. Chọn gói (test charge) thì Plans cập nhật |
| DV-01 | P2 | Thông tin API | Developers → **Copy** ở Public key, API endpoint | Toast "Copied", clipboard đúng |
| DV-02 | P2 | Headless | Gói dưới Pro: công tắc "Allow headless requests" bị khoá, có banner. Gói Pro: bật, nhập origin `http://evil.com/path` | Banner hoặc khoá đúng như mô tả. Origin sai báo "Use an origin like https://www.example.com (no path)" |
| HP-01 | P3 | Help | Bấm các link "Open theme editor", "Email support" | Mở đúng nơi |

### 5.18. Đa thị trường và ngôn ngữ (`MK`)

| Mã | Ưu tiên | Kịch bản | Các bước | Mong đợi |
|---|---|---|---|---|
| MK-01 | P1 | Giá theo market | Đổi country selector sang market EUR | Giá trên thẻ, trong dropdown gợi ý và nhãn thanh trượt đều là €, khớp với giá trên trang sản phẩm |
| MK-02 | P2 | Sản phẩm không bán ở market | Sản phẩm bị loại khỏi market EUR | Không hiện khi xem bằng market EUR |
| MK-03 | P2 | Ngôn ngữ | Đổi sang ngôn ngữ 2 | Tên sản phẩm (nếu có bản dịch), nhãn filter, sort, các chữ của widget đều theo ngôn ngữ 2 |

### 5.19. Khả năng truy cập (`A11Y`)

| Mã | Ưu tiên | Kịch bản | Mong đợi |
|---|---|---|---|
| A11Y-01 | P2 | Chỉ dùng bàn phím trên trang search | Tab tới được mọi filter, tiêu đề accordion (Enter/Space để mở), thanh trượt (mũi tên), sort, phân trang. Luôn thấy viền focus |
| A11Y-02 | P2 | Sheet mobile với bàn phím | Khi mở: focus vào nút ×. Tab chỉ chạy vòng trong sheet. Esc đóng và focus trả về nút Filters |
| A11Y-03 | P3 | Trình đọc màn hình (VoiceOver, TalkBack) | Ô search đọc là combobox. Sheet đọc là dialog "Filters". Thanh trượt đọc giá trị kèm tiền tệ ("$20"). Số kết quả được đọc khi thay đổi |
| A11Y-04 | P3 | Phóng to 200% | Không vỡ layout, không phải cuộn ngang |

### 5.20. Hiệu năng (`PF`)

| Mã | Ưu tiên | Kịch bản | Mong đợi |
|---|---|---|---|
| PF-01 | P1 | Lighthouse mobile trang chủ: tắt rồi bật app embed (mỗi trường hợp chạy 3 lần, lấy trung vị) | Điểm Performance giảm **≤ 5 điểm** |
| PF-02 | P2 | Trang search trên 4G | Kết quả của app hiện trong khoảng 1 giây sau skeleton. CLS < 0,1 (Lighthouse) |
| PF-03 | P2 | Admin | Các trang admin: LCP ≤ 2,5 giây, CLS < 0,1 (chuẩn Built for Shopify). Không trắng trang |

### 5.21. Gỡ và cài lại (`UN`)

| Mã | Ưu tiên | Kịch bản | Mong đợi |
|---|---|---|---|
| UN-01 | P1 | Gỡ app | Storefront không lỗi: không còn widget của app, search và collection dùng giao diện gốc của theme |
| UN-02 | P2 | Cài lại | Sync tự chạy lại từ đầu. Cấu hình cũ có thể mất (ghi nhận hành vi thực tế) |

### 5.22. Kiểm thử lại các lỗi đã sửa (`RG`)

| Mã | Lỗi cũ | Kiểm tra |
|---|---|---|
| RG-01 | Sync treo mãi ở "Syncing" khi Typesense tắt | `SY-13` |
| RG-02 | Storefront không hiện filter và sort, chỉ có lưới gốc | `SM-04`, `SR-01` |
| RG-03 | Store có mật khẩu: request bị 302 về `/password` | `FB-03` |
| RG-04 | Bấm Sync now báo "Bad Request" khi chạy qua tunnel | `SM-02` |
| RG-05 | Thanh tiến độ đứng 0% rồi nhảy 100% | `SY-01` |
| RG-06 | Thanh trượt giá co lại sau khi lọc | `PR-04` |
| RG-07 | Trang Sync phải reload mới thấy tiến độ | `SY-02`, `ON-09` |

## 6. Lỗi đã biết (chưa sửa)

Phát hiện khi rà soát code ngày 2026-10-26. Gặp đúng lỗi này thì ghi mã `KB-xx` vào cột kết quả, không cần báo lại.

| Mã | Mức | Mô tả | Ảnh hưởng tới kịch bản |
|---|---|---|---|
| KB-01 | **Cao** | Trang Search luôn hiện banner "AI search is included from the Pro plan" và khoá công tắc "Match by meaning", **kể cả shop gói Pro trở lên**. Nguyên nhân: quyền AI search không được truyền xuống giao diện | AS-10 |
| KB-02 | Trung bình | "Pages, In the search dropdown" bật sẵn, nên lần Save đầu tiên ở trang Search luôn hỏi quyền đọc trang. Từ chối thì vẫn lưu, không báo gì | AS-07 |
| KB-03 | Trung bình | Sửa một stop word tạo ra từ mới, từ cũ vẫn còn | MR-11 |
| KB-04 | Thấp | Merchandising lưu lỗi thì chỉ có lỗi dưới ô nhập, không có toast | MR-03, MR-05 |
| KB-05 | Thấp | Trang Plans ghi "chỉ khác nhau ở số sản phẩm và headless", nhưng AI search chỉ có từ gói Pro | PL-01 |
| KB-06 | Trung bình | Analytics → "Add synonym" mở dạng Two-way với 1 từ, nên Save báo "Add at least two words". Phải đổi sang One-way hoặc thêm từ | AN-04 |
| KB-07 | Thấp | Best selling chưa có dữ liệu (công tắc bị khoá) nhưng vẫn chọn được làm Default sort | ASO-06 |
| KB-08 | Thấp | Filter hoặc sort có thể để tên trống | AF-, ASO-03 |
| KB-09 | Thấp | Ô Weight (trang Search) nhập được 11, chỉ báo lỗi khi Save | AS-02 |
| KB-10 | Thấp (dev) | SDK: `SearchApp.on("ready")` không bao giờ được gọi. Chỉ có sự kiện DOM `searchapp:ready` | DV |
| KB-11 | Thấp | Xoá filter không hỏi xác nhận (Merchandising thì có). Link theme editor ở Help mở cùng tab, ở Home mở tab mới | AF-12, HP-01 |
| KB-12 | Trung bình | Appearance → "Products per row (desktop)" không có tác dụng trên storefront: setting "Columns" của block luôn được dùng thay | AP-03 |

## 7. Mẫu báo lỗi

```
Tiêu đề: [Mã kịch bản] Mô tả ngắn — ví dụ: [FM-03] Nút "Show N products" không đổi số sau khi chọn filter

Môi trường: store … · theme … · thiết bị / trình duyệt / bề ngang màn hình · market / ngôn ngữ
URL: …
Các bước:
  1. …
  2. …
Kết quả thực tế: …
Kết quả mong đợi: … (theo kịch bản …)
Tần suất: luôn luôn / thỉnh thoảng (x/10)
Đính kèm: ảnh chụp hoặc video; ảnh tab Network (lọc "apps/search") và Console nếu là lỗi storefront;
          giờ xảy ra (để đối chiếu log)
Mức độ: Blocker / Critical / Major / Minor
```
