# Đề xuất gói Subscription — Search & Filter app

> Cập nhật: 26/10/2026. Trạng thái: **đề xuất, chưa áp dụng**. Bảng giá đang chạy trong code nằm ở `app/lib/billing/plans.ts` (xem mục 6).
> Giá trên App Store đổi liên tục, nên các con số của đối thủ cần kiểm tra lại trước khi chốt.

---

## 1. Tóm tắt

- **Tính phí theo số sản phẩm** đang active và đã publish lên Online Store. Đây là cách Searchanise và Globo, hai app search phổ biến nhất, đang làm.
- **Gần như mọi tính năng có ở mọi gói.** Chỉ khoá những tính năng tốn tài nguyên hoặc dành cho người dùng nâng cao: AI/semantic search, headless API, giá cố định theo market, analytics dài hạn.
- **6 gói công khai và 1 gói Enterprise riêng (private plan).** Có trả theo năm (tặng 2 tháng) và trial 14 ngày.
- **Không bao giờ cắt search khi merchant vượt hạn mức.** Báo trước và cho thời gian ân hạn, đúng tinh thần Built for Shopify (không dùng pattern gây áp lực).

---

## 2. Thị trường

| App | Tính phí theo | Giá tham khảo | Ghi chú |
|---|---|---|---|
| Globo Smart Product Filter & Search | Số sản phẩm | $14 (500) · $19 (1k) · bản Plus $69–99 | Có Built for Shopify, 4.9★ |
| Searchanise | Số sản phẩm | Free (<25) · $19 (1,5k) · $39 (7,5k) · $89 (15k) · $139 (30k) · $209 (50k) · $349 (300k) · $499 (2 triệu) | Bản Plus đắt hơn |
| Sparq | Gói theo tính năng | $19 · $59 · $299 (mỗi 50k sản phẩm) | |
| Rapid Search | Session/tháng | Từ $14 (5k session) | "Không khoá tính năng"; vượt hạn mức thì quay về search mặc định của Shopify |
| Fast Simon | Session | $39,99 (2k) · $99,99 (10k) | |
| Doofinder / Motive | Số request search | ~$49 / €39 trở lên | Mỗi phím gõ ra kết quả mới tính 1 request |
| Boost | GMV | $29 đến $699+ | Merchant phàn nàn nhiều về cách tính theo GMV |
| Shopify Search & Discovery | Miễn phí | — | Semantic search chỉ có ở gói Shopify cao |

**Nhận xét**
- Tính theo session hoặc request làm hoá đơn tăng vọt vào mùa cao điểm, nên merchant không đoán trước được.
- Tính theo GMV bị phản đối nhiều.
- Tính theo số sản phẩm dễ hiểu nhất, và **khớp với chi phí hạ tầng** của mình: RAM Typesense tăng theo số sản phẩm × số ngôn ngữ × số market.

---

## 3. Bảng giá đề xuất

| Gói | Giá/tháng | Giá/năm (tặng 2 tháng) | Số sản phẩm tối đa | Rate limit search (rpm/shop) |
|---|---|---|---|---|
| **Free** | $0 | — | 250 | 600 |
| **Starter** | $12 | $120 | 1.000 | 3.000 |
| **Growth** | $29 | $290 | 5.000 | 6.000 |
| **Business** | $59 | $590 | 15.000 | 10.000 |
| **Pro** | $99 | $990 | 50.000 | 15.000 |
| **Scale** | $199 | $1.990 | 150.000 | 30.000 |
| **Enterprise** (private plan) | từ $349 | báo giá | 300.000+ | 60.000+ (tuỳ hợp đồng) |

- Mọi gói trả phí có **trial 14 ngày**.
- **Store dev và store test của partner:** mọi gói trả phí bật "free to test". Shopify chỉ cho partner ở organization khác test gói Free hoặc gói được đánh dấu free to test.
- Shopify managed pricing cho phép tối đa **8 gói công khai** và không giới hạn gói riêng. Bảng này dùng 6 gói công khai, còn chỗ cho 2 gói nữa nếu sau này cần, ví dụ bản Plus.

---

## 4. Tính năng theo gói

| Tính năng | Free | Starter | Growth | Business | Pro | Scale | Enterprise |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Instant search (autocomplete) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Trang kết quả và filter collection | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bật/tắt và trọng số trường search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sorting tuỳ chỉnh (gồm Shopify best-selling) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Synonym, stop word, redirect | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pin / boost / bury / hide | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Giá theo market (quy đổi tự động) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| SDK và custom section trong theme | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Đa ngôn ngữ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Best-selling theo order 60 ngày | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Analytics | 7 ngày | 30 ngày | 90 ngày | 180 ngày | 365 ngày | 365 ngày | tuỳ chỉnh |
| Giá cố định theo market (price list) | — | — | — | ✓ | ✓ | ✓ | ✓ |
| AI / semantic search | — | — | — | — | ✓ | ✓ | ✓ |
| Headless API (ngoài theme) | — | — | — | — | ✓ | ✓ | ✓ |
| Hỗ trợ | Email | Email | Email + chat | Ưu tiên | Ưu tiên | Ưu tiên | SLA riêng |

**Cách quyết định khoá tính năng gì:** chỉ khoá khi tính năng (a) tốn tài nguyên thật (CPU embedding, giá theo từng market, lưu analytics dài), hoặc (b) dành cho dev/agency (headless). Tính năng search cơ bản không khoá, vì khoá chúng dễ bị đánh giá thấp và đối thủ (Rapid Search) đang dùng "không khoá tính năng" để quảng cáo.

---

## 5. Quy tắc vận hành

### 5.1 Cách đếm sản phẩm
- Đếm **product** đang active và đã publish lên Online Store. **Không đếm variant.**
- Khi merchant bật "hiển thị variant như sản phẩm" thì vẫn đếm theo product. Nếu sau này chi phí tăng, ghi rõ trong listing trước khi đổi cách đếm.
- Số liệu lấy từ lần đồng bộ cuối và hiển thị trên trang **Plans**: "Đang dùng X / Y sản phẩm".

### 5.2 Khi vượt hạn mức sản phẩm
1. Đạt 80%: banner thông tin trên Home và Plans.
2. Vượt 100%: banner cảnh báo, **ân hạn 14 ngày**. Search vẫn chạy đầy đủ.
3. Hết ân hạn mà chưa nâng gói: **sản phẩm mới vượt hạn mức không được index**. Sản phẩm đã có vẫn tìm được, storefront không bao giờ trống.
4. Không đếm ngược, không popup chặn màn hình, không đổi gói tự động.

### 5.3 Khi traffic tăng đột biến
- Rate limit theo rpm của gói (bảng mục 3). Vượt giới hạn thì trả lỗi 429 cho phần vượt, storefront tự quay về kết quả native.
- Nếu vượt liên tục 3 ngày trong tháng, gửi email gợi ý nâng gói. Không tính phí thêm.

### 5.4 Nâng hoặc hạ gói
- Merchant tự đổi gói trong app, không cần liên hệ support (yêu cầu của App Store). Shopify tự tính pro-rata.
- Hạ xuống gói thấp hơn hạn mức sản phẩm hiện có: áp dụng quy tắc 5.2 ngay, với 14 ngày ân hạn.
- Tính năng không còn trong gói thì **disable kèm giải thích**, giữ nguyên cấu hình để bật lại khi nâng gói.

### 5.5 Enterprise
- Gói riêng tạo trong Partner Dashboard cho từng store.
- Có thể thêm **usage meter** cho search vượt mức, chỉ khi hợp đồng ghi rõ. Managed pricing **không hỗ trợ đặt trần chi phí**, nên phải thống nhất trước với merchant.

---

## 6. So với bảng giá đang chạy trong code

| Gói | Code hiện tại (`plans.ts`) | Đề xuất |
|---|---|---|
| Free | ≤ 99 sản phẩm | ≤ 250 |
| Starter | $9 · 1k | $12 · 1k |
| Growth | $19 · 5k | $29 · 5k |
| Business | (chưa có) | $59 · 15k |
| Pro | $49 · 30k | $99 · 50k |
| Scale | $99 · 100k | $199 · 150k |
| Enterprise | $199 · 300k | từ $349 · 300k+, private plan |
| Headless | từ $49 (Pro) | từ Pro ($99) |
| Semantic | từ $49 (Pro) | từ Pro ($99) |

**Việc cần làm khi chốt:**
1. Sửa `PLANS` trong `app/lib/billing/plans.ts`: thêm `business` và các cờ tính năng (`multiLanguage`, `orderRanking`, `fixedMarketPrices`, `analyticsDays`, `merchRules`).
2. Khai báo gói trong Partner Dashboard (Shopify App Pricing). Tên gói phải khớp với `Plan.name`. Bật annual, trial 14 ngày và free to test.
3. Cập nhật trang Plans, banner hạn mức (5.2) và test đổi gói.
4. Cập nhật listing App Store (`docs/app-store/`).

---

## 7. Chi phí và lợi nhuận (ước tính sơ bộ, cần đo thực tế)

- RAM Typesense: khoảng 2–3 lần dung lượng document. 30k sản phẩm × ~3 KB ≈ 90 MB dữ liệu thô, tức khoảng 250 MB RAM, cỡ $2–3/tháng hạ tầng.
- Bulk sync không tốn rate limit của Shopify, nên chi phí sync chủ yếu là CPU worker.
- Search: cache ngắn hạn cộng CDN giúp giảm tải. Chi phí tăng theo traffic, được kiểm soát bằng rpm theo gói.
- Kết luận: kể cả ở Starter $12, lợi nhuận gộp vẫn cao. Rủi ro chính là **shop nhiều ngôn ngữ × nhiều market** (RAM nhân lên), nên đa ngôn ngữ và giá cố định theo market đặt ở gói Growth và Business trở lên.

---

## Nguồn
- Shopify managed pricing: https://shopify.dev/docs/apps/launch/billing/managed-pricing
- Searchanise pricing: https://searchanise.io/pricing/
- Globo: https://globo.io/smart-product-filter-search
- Sparq: https://apps.shopify.com/sparq-search
- Rapid Search: https://www.rapidsearch.app/pricing
- Motive (blog của đối thủ, so sánh giá): https://motive.co/blog/best-shopify-search-app
