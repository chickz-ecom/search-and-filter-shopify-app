# Nghiên cứu: App Search & Filter trên Shopify — cách hoạt động, Index, Sync, Search

> Cập nhật: 26/10/2026. Nguồn tham khảo: tài liệu chính thức của shopify.dev, help center của từng app, trang App Store và review của merchant.
> Ký hiệu: **[XN]** = đã xác nhận từ nguồn · **[SL]** = suy luận từ dấu hiệu · **[CHƯA XN]** = chưa xác nhận được, cần kiểm tra lại.
> Đi kèm file này: `02-PLAN.md` (kế hoạch triển khai cho Claude).
> Phạm vi: app **search & filter** (không có chat AI). Có thêm mục 8 (currency) và mục 9 (trọng số, sorting, developer API).

---

## 0. Tóm tắt

1. **Các app đều làm theo một mô hình chung.** Searchanise, Globo (Smart Product Filter & Search) và Boost đều **sao chép toàn bộ catalog về hạ tầng của họ**, rồi index vào search engine riêng.
   - Storefront gọi thẳng API search của họ, không dùng search của Shopify.
   - Kết quả được **render phía client bằng JS** nạp qua *theme app extension (app embed)*.
2. **Sync luôn có 4 lớp:**
   1. Webhook cho thay đổi gần realtime.
   2. Poll đối soát mỗi 1–10 phút để bắt webhook bị lỡ.
   3. Full re-index hằng đêm.
   4. Nút "Sync now" cho merchant.
   - Lý do: webhook của Shopify **không đảm bảo thứ tự**, có thể bị lỡ, và **có những thay đổi không bắn webhook**: smart collection đổi thành viên, sắp xếp thủ công trong collection, import CSV hoặc bulk.
3. **Ba điểm yếu chung theo review của merchant:**
   - Sync chậm hoặc kẹt.
   - Xung đột với theme (do ẩn grid của theme rồi tự vẽ lại).
   - Engine sập thì trang collection trống trơn (lỗi một điểm).
   - App mới có thể thắng ở ba chỗ này.
4. **Về nền tảng Shopify tháng 10/2026:**
   - **Template Remix đã chuyển thành React Router v7.** Shopify khuyên app mới dùng `shopify-app-template-react-router`.
   - **Polaris React đã bị deprecate.** Dùng **Polaris web components** (bản 2.x, stable từ 22/10/2026).
   - Chỉ dùng **GraphQL Admin API**.
   - Bắt buộc **expiring offline token** cho app public tạo sau 01/04/2026.
   - **ScriptTag không tạo được nữa** từ 01/10/2026 và ngừng chạy từ 01/03/2027. Storefront phải dùng *theme app extension*.
5. **Built for Shopify (BFS)** có hai rủi ro lớn nhất với app filter:
   - App **không được làm giảm quá 10 điểm Lighthouse** trên storefront. Trọng số trang: Home 17%, Product 40%, **Collection 43%**.
   - Admin phải đạt **LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms** ở p75.

---

## 1. Searchanise Search & Filter

**Thông tin chung** [XN]
- Đánh giá 4.7★, khoảng 1.261 review, ra mắt 2015.
- Đa nền tảng: Shopify, BigCommerce, WooCommerce, Wix, Magento…
  - Nghĩa là backend search trung lập nền tảng, mỗi nền tảng có một connector riêng.
- Huy hiệu BFS: hai nguồn mâu thuẫn nhau [CHƯA XN].
- Giá tính theo **số sản phẩm active**, không theo số truy vấn:

| Gói | Giá/tháng | Số sản phẩm |
|---|---|---|
| Free | $0 | < 25 |
| Basic | $19 | 1.500 |
| … | … | … |
| Premium | $349 | 300k |
| Enterprise | $499 | 2 triệu |

  - Bản cho Shopify Plus đắt hơn.

**Kiến trúc** (được công bố khá chi tiết) [XN]
- **Engine:** họ tự host, dùng full-text engine **Sphinx**.
  - Trọng số: title và SKU cao nhất, description thấp nhất.
  - Exact match được xếp đầu, có chịu lỗi chính tả (typo tolerance), tìm được SKU một phần.
  - Autocomplete lấy từ từ điển Hunspell, nội dung shop và lịch sử tìm kiếm.
  - Rule merchandising có ưu tiên cao nhất.
- **Search API công khai** (`searchserverapi1.com`):
  - `/search` chỉ trả ID; `/getwidgets` trả payload cho autocomplete; `/getresults` trả payload cho trang kết quả.
  - Tham số: `apiKey` (public), `q`, `restrictBy[attr]` (hỗ trợ `|` = OR, `,` = AND, khoảng `from,to`), `facets`, `sortBy`, `startIndex`, `maxResults` (≤ 250).
  - Trả về `items`, `categories`, `pages`, `suggestions`, `correctedQuery`, `facets` (kiểu select/range/slider kèm bucket và count).
- **Update (ingest) API** dùng `private_key`:
  - Gửi JSON gồm phần **`schema`** khai báo kiểu thuộc tính: text/int/float, `text_search`, `sorting`, `weight`, `facet`.
  - Mỗi batch tối đa 250 item.
  - Full import được bọc bởi `full_import=start|done`. Thay đổi đến trong lúc full import được giữ lại cho tới khi `done`.
  - Xử lý bất đồng bộ.
  - → **Đây là mô hình schema đáng tham khảo.**
- **Widget:** dùng object JS `Searchanise` cùng loader `init.js`. HTML kết quả do JS sinh ra, không dùng Liquid.

**Sync** [XN]
- Khoảng 70% cập nhật product/collection đến trong ~2 phút qua webhook. Phần còn lại đến trong ~10 phút qua "Shopify API" (poll).
- Những thứ **không** tự theo dõi, phải "Force re-indexation" hoặc chờ re-index hằng ngày:
  - Collection, order, blog/article.
  - Sắp xếp lại thứ tự trong collection, tạo collection mới.
  - Import sản phẩm, đổi currency/location.
- Index cả **order** để xếp hạng "bestseller".
- Không công bố có dùng bulk operations hay không [SL: full re-index nhiều khả năng dùng bulk].

**Dữ liệu được index** [XN]
- Gồm: product active trên kênh Online Store, collection, page, blog post, order.
- Loại trừ: product có tag loại trừ, và product hết hàng nếu merchant bật ẩn.
- Tách variant thành kết quả riêng là tính năng theo gói.
- **Markets:**
  - Index catalog theo market, giá theo vùng.
  - Tắt giá theo vùng thì index "nhanh hơn đáng kể" [SL: giá theo từng market làm phình index].
  - Tồn kho chỉ tính ở mức global.
- Đa ngôn ngữ: hỗ trợ ngôn ngữ native của Shopify cùng Langify, LangShop, Weglot.

**Tích hợp storefront** [XN]
- Bật **app embed** trong theme editor, theo từng theme. Script chỉ chạy sau khi trang tải xong.
  - Muốn nhanh hơn thì phải chèn snippet thủ công trước `content_for_header`.
- **Trang kết quả là một Shopify Page do app tạo ra.** Không thay `/search`. Xoá page đó thì ra 404.
- Filter trên collection dùng lại widget kết quả.

**Merchant phàn nàn gì** (review 1–2★) [XN]
- **Sập server đúng Black Friday làm trang không hiện sản phẩm.**
- Kết quả thiếu hoặc không liên quan.
- Lỗi ảnh trên mobile, xung đột theme, code nặng.
- Support chậm, tranh chấp hoàn tiền.

---

## 2. Smart Product Filter & Search (Globo)

**Thông tin chung** [XN]
- 4.9★, khoảng 2.388 review, **có huy hiệu Built for Shopify**.
- Nhà phát triển ở Hà Nội, ra mắt 2018.
- Giá:
  - Basic $14/tháng (500 sản phẩm), $19 (1.000 sản phẩm).
  - PRO $29: thêm semantic search bằng AI, 40+ metafield, analytics 180 ngày.
  - Bản Plus $69–$99. Dùng thử 14 ngày.

**Kiến trúc** [XN]
- "App giữ **bản sao catalog riêng** để filter và search nhanh."
- Không có tài liệu search API công khai [SL: JS gọi endpoint do Globo host].
- **Storefront dùng theme app extension (app embed).** Không sửa `theme.liquid`. Asset phục vụ từ `cdn.shopify.com/extensions/...`.
- **Cách render:** file `globo-filter-critical.css` (~15 KB) dùng class `.spf-filter-loading` để **ẩn grid sản phẩm của theme** và hiện skeleton.
  - File này nhắm tới **khoảng 250 selector đặc thù theme**, ví dụ `#ProductGridContainer`, `#CollectionAjaxContent`.
  - [SL] Tức là app ẩn grid của theme rồi tự render lại bằng JS. **Đây là nguồn chính gây xung đột theme.**
- Instant search thay hành vi ô search của theme. Trang `/search` giữ nguyên, có thể chèn thêm sidebar filter.

**Sync** [XN] — rất đáng học
- Webhook cho product, collection và inventory level (create/update/delete).
- **Auto sync mỗi 1–2 phút** để bắt webhook bị lỡ.
- **Full re-index mỗi ngày** (ví dụ 3:30 sáng) và nút "Sync now".
- Họ nói thẳng: Shopify **không luôn bắn webhook** khi product vào/ra *smart collection*; import CSV/bulk có thể không bắn webhook.
- Đổi metafield, đổi rule smart collection, hay dịch bằng Translate & Adapt thì phải bấm Sync now.

**Dữ liệu và tính năng** [XN]
- Dữ liệu: metafield của product và variant, option, tồn kho theo location, collection lồng nhiều cấp, bản dịch, multi-currency, **catalog Markets, catalog và giá B2B**.
- Merchandising: chỉnh relevance, typo tolerance, synonym thủ công và synonym AI, stop word, redirect, fallback search, campaign.
- Analytics: top query, query không có kết quả, mức dùng filter, tổ hợp filter phổ biến.
- Tính năng ngách: Year/Make/Model, 9 loại gợi ý sản phẩm, hiển thị variant như một product.

**Merchant phàn nàn gì** [XN]
- Trang search hoặc collection vỡ, nhất là trên mobile; có lúc "không trang collection nào load được".
- Sync kẹt hơn 8 giờ; sản phẩm đã xoá vẫn hiện (cache cũ); thứ tự thủ công của collection không được phản ánh.

---

## 3. Đối chiếu nhanh: Boost AI Search & Filter, và Search & Discovery của Shopify

**Boost** [XN]
- Ngày 26/10/2026, trang App Store ghi **"not currently available"** (chưa rõ lý do) [CHƯA XN].
- Giá theo **GMV**, $29 đến $699+.
- **Kiến trúc:**
  - Engine host tại `services.mybcapps.com`, endpoint `/bc-sf-filter/filter`, `/bc-sf-filter/search`; JSONP; response có cờ `from_cache`.
  - Có JS SDK cache response và trả JSON hoặc HTML template dựng sẵn.
- **Sync:**
  - Cập nhật xếp hàng đợi, xử lý ~**4 update/giây**, nên catalog lớn bị trễ.
  - "Shopify không có webhook khi sắp xếp collection."
  - Bestseller cần một collection ẩn "Boost All", rank lưu vào metafield.
- **AI:** trích ý định ("red dress under 50" thành filter), synonym học từ log truy vấn, cá nhân hoá.

**Search & Discovery (miễn phí, của Shopify)** [XN]
- 2.6★, khoảng 510 review.
- Giới hạn của filter:
  - Tối đa 25 filter mỗi store, 100 giá trị mỗi filter.
  - Không filter được collection có hơn 5.000 sản phẩm.
  - Facet count chỉ tính trên 1.000 kết quả đầu.
  - Filter giá ẩn khi dùng currency không phải mặc định.
- Search:
  - Synonym tối đa 1.000 mỗi store; boost 10 term mỗi sản phẩm.
  - Semantic search chỉ có ở gói Shopify trở lên, storefront tiếng Anh, dưới 200k sản phẩm.
- Không có banner, rule, redirect; analytics rất mỏng. → **Đây là khoảng trống thị trường.**
- Storefront API có `search` (facet qua `productFilters`, `totalCount` tối đa 1.000) và `predictiveSearch` (`limit` 1–10). Ajax có `/search/suggest.json`.

**Lớp AI/agent miễn phí của Shopify** [XN]
- Theo blog của một vendor, Shopify bật **WebMCP** trên mọi storefront Liquid từ 21/08/2026, gồm các tool `search_catalog`, `get_product`, `update_cart`…
- Có **UCP (Universal Commerce Protocol):**
  - Endpoint `https://{shop}/api/ucp/mcp`, yêu cầu agent profile.
  - Gồm Storefront Catalog MCP (`search_catalog`, `lookup_catalog`, `get_product`), Cart MCP, Checkout MCP, Ask MCP (`ask_business`).
  - **Storefront MCP cũ** (`/api/mcp`, mà template `shop-chat-agent` dùng) **đã bị gỡ phần catalog và cart**.
- Shopify Inbox đã có "Inbox agent" chat AI không cần code.
- → Search cơ bản cho agent AI đang thành **hạ tầng miễn phí**. App mới phải thắng bằng **relevance, merchandising, analytics và độ ổn định**.
  - Chat AI nằm ngoài phạm vi app này.

---

## 4. Bảng so sánh

| | Searchanise | Globo | Boost | Shopify S&D |
|---|---|---|---|---|
| Rating | 4.7 / ~1,3k | 4.9 / ~2,4k | ~4.6 / ~1,5k (đang ẩn) | 2.6 / 510 |
| BFS | Chưa rõ | Có | Có (theo roundup) | — |
| Giá theo | Số sản phẩm | Số sản phẩm | GMV | Miễn phí |
| Engine | Sphinx, tự host | Bản sao riêng, không công bố engine | Tự host | Native |
| Webhook | Có (~70% trong 2 phút) | Có (product, collection, inventory) | Có (hàng đợi ~4/s) | — |
| Đối soát | Poll 10 phút + hằng ngày + thủ công | 1–2 phút + hằng ngày + thủ công | Theo gói + thủ công | — |
| Theme | App embed; trang kết quả là Page | App embed, ẩn grid theme và render lại | App embed + block (TURBO) | Liquid native |
| Render | JS client | JS client + skeleton | JS / HTML template | Liquid server |
| Markets/B2B | Markets (tồn kho global) | Markets + B2B | Markets; B2B ở gói cao | Hạn chế |

---

## 5. Kiến trúc chung rút ra (index → sync → search → render)

```
           ┌──────────────────── Shopify ────────────────────┐
           │ GraphQL Admin API  Webhooks/Events  Theme (OS2.0) │
           └──────┬─────────────────┬───────────────┬─────────┘
   bulk op (JSONL)│     webhook/event│               │ app embed + app block
                  ▼                  ▼               │ (assets từ Shopify CDN)
        ┌────────────────────────────────────┐       │
        │ Sync workers (queue, debounce)      │       │
        │  - initial full index               │       │
        │  - incremental theo product ID      │       │
        │  - poll đối soát updated_at         │       │
        │  - full re-index đêm + alias swap   │       │
        └──────────────┬─────────────────────┘       │
                       ▼                              ▼
              ┌───────────────┐   query   ┌──────────────────────┐
              │ Search engine │◀──────────│ Search API công khai  │◀── JS storefront
              │ (per shop)    │           │ (cache, CDN, rate-limit)│    (instant, results,
              └───────────────┘           └──────────────────────┘     filter, beacon)
```

1. **Cài app và index lần đầu.**
   - Kéo product, variant, collection và thành viên collection, tồn kho, metafield dùng cho filter, bản dịch, giá theo market, page/blog, order (cho bestseller).
   - Chỉ index product **Active + Published lên Online Store** (`published_status:published`), loại cả trạng thái mới **`unlisted`**.
   - Công cụ chuẩn: **GraphQL bulk operations**, xem mục 6.3.
2. **Sync tăng dần (4 lớp)** như phần tóm tắt.
   - Webhook nên chỉ đóng vai **tín hiệu "product X đã đổi"**. Worker sẽ **lấy lại bản mới nhất bằng GraphQL** rồi upsert, để tránh lỗi thứ tự.
3. **Mô hình index.**
   - Schema có kiểu và có trọng số (học từ Searchanise).
   - Một document cho mỗi product, kèm tổng hợp variant: khoảng giá, option, còn hàng.
   - Tuỳ chọn variant-as-document.
   - Thêm chiều market, ngôn ngữ, currency. Index riêng cho collection, page, article.
4. **Query API.**
   - GET công khai, cache được qua CDN, định danh bằng shop hoặc public key.
   - Gồm full-text, filter, facet count, sort, phân trang, scope theo collection, context market/currency/khách B2B.
   - Có endpoint riêng, rất nhẹ, cho autocomplete.
5. **Render storefront.**
   - Mọi đối thủ đều render bằng JS client. Đây là nguyên nhân gây CLS, chậm, rủi ro SEO, xung đột theme, và trang trống khi engine sập.
6. **Merchandising và analytics.**
   - Synonym, stop word, redirect, pin/boost/bury, banner, gợi ý sản phẩm.
   - Analytics bằng beacon từ widget: query, zero-result, click, filter.

**Cơ hội khác biệt cho app mới:**
1. Render trước bằng Liquid hoặc app block, có **fallback sang filter native** khi engine lỗi.
2. **Hiển thị trạng thái sync minh bạch**: độ trễ, số job, lỗi.
3. Dùng **Events API** (GA từ 2026-10) với `collection.products` và `collection.sortOrder` để bắt thay đổi collection mà webhook bỏ sót. Với smart collection thì cần test, vì chưa xác nhận.
4. **Hiển thị giá đúng currency và market** bằng Storefront API: 1 request cho cả trang (mục 8), filter giá hoạt động ở mọi currency.
5. Định giá theo số sản phẩm, đơn giản và minh bạch.

---

## 6. Nền tảng Shopify (chuẩn tháng 10/2026)

### 6.1 Template và thư viện
- **Remix → React Router v7.**
  - README của template Remix ghi: *"Remix is now React Router… For new projects, use the Shopify App Template – React Router."*
  - Khởi tạo bằng: `shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router`
  - `@shopify/shopify-app-react-router` mới nhất là **4.0.0**: cần Node ≥ 22, mặc định Polaris 2.x, peer `react-router ^7.6.2`.
  - **Không nâng lên React Router 8.**
  - Template đang pin `react-router 7.18.2`, và vẫn để `@shopify/shopify-app-react-router ^3.0.1` cùng `polaris-types 1.0.1`. Cần **chủ động nâng lên 4.x và `@shopify/polaris-types@^2`**.
  - Gói Remix vẫn được vá (6.0.2), nhưng chỉ dành cho app cũ.
  - React Router vẫn mang "tinh thần Remix" (loader/action/route modules), nên yêu cầu "Remix Shopify" của bạn được đáp ứng bằng template này.
- **CLI** `@shopify/cli` 4.9.x, cần Node ≥ 22.12. Các lệnh chính:
  - `shopify app dev|deploy|release|versions list`
  - `shopify app config link|use|pull|validate`
  - `shopify app generate extension`, `shopify app webhook trigger`
  - `shopify app bulk execute|status`, `shopify app logs`
  - `shopify app security check|review`
- **Auth:**
  - **Managed installation** (scope khai trong TOML) cùng **token exchange** (đổi session token / ID token lấy access token, không redirect).
  - **Expiring offline access tokens** (60 phút, thư viện tự refresh) bắt buộc với app public tạo từ 01/04/2026. Trong Prisma, model `Session` có `refreshToken` và `refreshTokenExpires`.
  - App phải chạy được **không cần cookie bên thứ ba hay localStorage**, kể cả ở chế độ incognito.
- **Database:** template mặc định SQLite, chỉ ổn khi chạy một instance. → **Dùng PostgreSQL.**
- **Lưu ý trong README:**
  - Khai webhook trong TOML, không dùng `afterAuth` / `registerWebhooks`.
  - Dùng `Link` của react-router và `redirect` lấy từ `authenticate.admin`, không dùng thẻ `<a>` trần.
  - **Route webhook không được nằm dưới layout `app.tsx`.**

### 6.2 Admin UI: App Bridge và Polaris web components
- **Polaris React đã bị deprecate** (thông báo trên npm). App mới **chỉ dùng Polaris web components** (`s-page`, `s-section`, `s-stack`, `s-grid`, `s-box`, `s-button`, `s-text-field`, `s-select`, `s-checkbox`, `s-choice-list`, `s-badge`, `s-banner`, `s-table`, `s-modal`, `s-popover`, `s-spinner`, `s-empty-state`, `s-progress`…).
  - Không có sẵn tương đương cho Combobox, Tabs, Collapsible, RangeSlider; phải tự ghép.
- **Polaris 2.0** stable từ 22/10/2026, khớp với giao diện admin mới (rollout từ 15/09/2026).
  - CDN: `https://cdn.shopify.com/shopifycloud/polaris-2.js`.
  - App BFS phải lên Polaris 2 **trước 01/05/2027**.
  - Trong thời gian rollout, app phải hiển thị đúng ở **cả hai giao diện admin**.
- **App Bridge** là script CDN, phải đứng **trước mọi script khác** trong `<head>`:

```html
<meta name="shopify-api-key" content="%SHOPIFY_API_KEY%" />
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<script src="https://cdn.shopify.com/shopifycloud/polaris-2.js"></script>
```

  (`AppProvider` của React Router đã tự chèn các thẻ này.)
- **Thành phần bắt buộc hoặc nên dùng:**
  - `<s-app-nav>` để làm nav (`ui-nav-menu` là legacy).
  - `<s-page heading>` với slot `primary-action` / `secondary-actions`.
  - Save bar: dạng khai báo `<form data-save-bar data-discard-confirmation>` hoặc `<ui-save-bar>` cùng `shopify.saveBar`; không trộn hai kiểu trên cùng một trang.
  - `<s-modal>` và `<s-app-window>` (không dùng Fullscreen cũ).
  - API: `shopify.toast`, `shopify.resourcePicker`, `shopify.intents.invoke('edit:shopify/Product', …)`, `shopify.idToken()`, `shopify.webVitals.onReport()`.
  - **`shopify.app.extensions()`** trả trạng thái app block / app embed trên theme đang publish. **BFS yêu cầu trang Home hiển thị trạng thái này.**

### 6.3 Đồng bộ dữ liệu
**Bulk operations** (`bulkOperationRunQuery`)
- Từ API 2026-01: **tối đa 5 bulk query đồng thời** mỗi shop mỗi app.
- Mỗi query tối đa 5 connection, lồng tối đa 2 cấp.
- Kết quả là **JSONL**: dòng con có `__parentId`, phải stream-parse.
- Không tốn rate limit. URL kết quả sống 1 tuần, operation có tối đa 10 ngày để xong.
- Theo dõi bằng webhook `bulk_operations/finish`, hoặc poll `bulkOperation(id:)`. `currentBulkOperation` bị deprecate từ 2026-01.

```graphql
mutation {
  bulkOperationRunQuery(query: """
  { products(query: "status:active AND published_status:published") {
      edges { node {
        id handle title vendor productType tags status updatedAt
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        featuredMedia { preview { image { url } } }
        metafields { edges { node { namespace key type value } } }
        variants { edges { node { id sku price compareAtPrice availableForSale
          inventoryQuantity selectedOptions { name value } } } }
  } } } }""") { bulkOperation { id status } userErrors { field message } }
}
```

  Chạy song song một bulk khác để lấy collection và thành viên của nó.

**Webhook**
- Khai **app-specific** trong `shopify.app.toml` (cách được khuyến nghị).
- Đích nhận: HTTPS, **Google Pub/Sub (được khuyến nghị)** hoặc EventBridge.
- Với HTTPS:
  - Xác thực `X-Shopify-Hmac-SHA256` (HMAC-SHA256 base64 trên **raw body**, so sánh bằng `timingSafeEqual`).
  - Phải phản hồi trong **5 giây**. Shopify retry 8 lần trong 4 giờ.
- **Không đảm bảo thứ tự.** Xử lý như sau:
  - Dùng `X-Shopify-Triggered-At` để bỏ bản cũ.
  - Dedupe theo `X-Shopify-Webhook-Id`.
  - Đối soát định kỳ theo `updated_at`.
- Có thể dùng `filter` và `include_fields` để giảm payload.
- Topic cần dùng:
  - `products/create|update|delete`, `collections/create|update|delete`
  - `inventory_levels/update`, `inventory_items/update`
  - `product_listings/*`, `collection_listings/*`
  - `locales/*`, `markets/*`
  - `app/uninstalled`, `app/scopes_update`, `bulk_operations/finish`
- **`collections/update` KHÔNG bắn khi thành viên smart collection thay đổi do thuộc tính sản phẩm đổi.**

**Events API** (GA cùng 2026-10)
- Chọn trigger theo từng field, kèm GraphQL `query` để lấy dữ liệu ngay trong payload, có `query_filter`. Payload có `fields_changed`.
- Hỗ trợ Product, Collection, InventoryItem, Location… Cần CLI 4.83 trở lên. Query tối đa 100 điểm.
- Trigger của Collection gồm `collection.products` (danh sách sản phẩm thay đổi; payload có ID sản phẩm thêm hoặc bớt trong `fields_changed`), `collection.sortOrder`, `collection.title`, `collection.metafield(...)`, …
  - `collection.sortOrder` bắt được việc **đổi kiểu sắp xếp collection**, một lỗ hổng mà các đối thủ phàn nàn.
  - Tài liệu **không nói rõ** `collection.products` có bắn khi thành viên **smart collection** đổi do thuộc tính sản phẩm đổi hay không [CHƯA XN]. Phải test thực tế; nếu không bắn thì vẫn trông vào lớp poll đối soát.
  - Nguồn: https://shopify.dev/docs/api/events/latest/collection

```toml
[events]
api_version = "2026-10"
[[events.subscription]]
handle = "collection-membership"
topic = "Collection"
actions = ["update"]
triggers = ["collection.products"]
uri = "/api/events/collections"
```

**Rate limit GraphQL**
- Leaky bucket tính theo cost. Tốc độ hồi: 100 điểm/giây (Standard), 200 (Advanced), 1.000 (Plus), 2.000 (Enterprise).
- Mỗi query tối đa 1.000 điểm. Theo dõi `extensions.cost.throttleStatus`.

**Model sản phẩm và collection**
- Tối đa 2.048 variant mỗi product. Có trạng thái `unlisted`.
- **Collection model mới (API 2026-07):** `Collection.sources` thay `ruleSet`. Collection dùng tính năng mới sẽ **bị ẩn với API version cũ**, nên phải dùng **2026-10**.
- Bản dịch: `translatableResources` / `Product.translations(locale:)` (scope `read_translations`, `read_locales`, `read_markets`).

### 6.4 Storefront
**Theme app extension**
- Gồm `blocks/`, `snippets/`, `assets/`, `locales/`.
- **App block** (`target: section`) chỉ dùng được trên template JSON của OS 2.0.
- **App embed** có target `head` / `body` / `compliance_head`.
- Giới hạn:

| Hạng mục | Giới hạn |
|---|---|
| Tổng dung lượng | 10 MB |
| Số block | 30 |
| Liquid (tổng) | 100 KB |
| CSS mỗi block (khuyến nghị) | ≤ 100 KB |
| **JS mỗi block (khuyến nghị)** | **≤ 10 KB nén** |

- Deep link để thêm block hoặc bật embed:
  - `…/admin/themes/current/editor?template=search&addAppBlockId={api_key}/{handle}&target=mainSection`
  - `…/editor?context=apps&activateAppId={api_key}/{handle}`

**ScriptTag:** không tạo hoặc sửa được từ 01/10/2026; **ngừng chạy 01/03/2027**.

**App proxy**
- `[app_proxy] url="/proxy" prefix="apps" subpath="search"` phục vụ `https://shop/apps/search/*`.
- Trả `Content-Type: application/liquid` thì nội dung được render trong layout của theme. Helper: `authenticate.public.appProxy(request)`.
- Shopify xoá cookie đi qua proxy.
- Chữ ký: HMAC-SHA256 dạng **hex** trên các tham số đã sort, nối liền không dấu phân cách.

**Native storefront**
- URL `/search?q=`, filter bằng tham số (`filter.v.price.gte`, `filter.p.m.ns.key`…).
- `/search/suggest.json` (tối đa 10 kết quả mỗi loại).
- Storefront API tokenless: `search`, `predictiveSearch`.
- → Dùng làm **fallback** khi engine của app lỗi.

**Web Pixel**
- Extension `web_pixel`, `runtime_context = "strict"`. Lắng nghe `search_submitted`, `collection_viewed`, `product_viewed`, `product_added_to_cart`…
- Scope: `write_pixels`, `read_customer_events`.

### 6.5 Yêu cầu Built for Shopify (tóm lược)
Nguồn: https://shopify.dev/docs/apps/launch/built-for-shopify/requirements

**1. Điều kiện**
- Đạt mọi yêu cầu của App Store.
- **Ít nhất 50 lượt cài net** trên shop trả phí, **ít nhất 5 review**, rating gần đây tối thiểu (con số không công bố).

**2. Hiệu năng**
- Admin, đo p75 trong 28 ngày: **LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms**, mỗi chỉ số cần ≥ 100 mẫu.
- Storefront: **Lighthouse mobile giảm không quá 10 điểm** (Home 17%, Product 40%, Collection 43%), đo trên theme sạch như Horizon.

**3. Tích hợp**
- Có App Bridge mới nhất trong `<head>`. Luồng chính hoàn thành được ngay trong admin.
- **Không bắt đăng ký hay đăng nhập riêng.**
- Có metric chính ở Home.
- Storefront **chỉ qua theme app extension**; **không ghi Asset API**.

**4. Thiết kế**
- Giống admin, tương phản WCAG 2.1 AA, có nút back ở trang con, không dùng font serif, không dùng emoji trong nav.
- Chạy được trên mobile; dùng `s-app-nav`.
- **Contextual Save Bar** cho mọi form.
- Dùng `s-modal` / `s-app-window`.
- Onboarding ngắn gọn, đóng được. **Home hiển thị trạng thái setup và trạng thái embed.**
- Lỗi hiển thị đỏ, inline, kèm cách sửa. Một nút chính nổi bật cho bước tiếp theo.
- **Live preview đặt cạnh editor** khi chỉnh giao diện widget.
- Không dùng chiêu gây áp lực, không đếm ngược trial, không bắt chước Shopify (icon Sidekick, màu tím "magic" cho AI). Tính năng theo gói phải disable rõ ràng.

**5. Theo danh mục:** không có danh mục search/discovery riêng. Nếu định vị là Analytics thì phải dùng Web Pixel.

**Liên quan từ App Store requirements**
- **Chỉ GraphQL Admin API** (app public mới từ 01/04/2025).
- Billing qua **Shopify App Pricing (managed)** hoặc Billing API; merchant tự đổi gói được.
- OAuth chạy ngay khi cài.
- Không submit được nếu dùng API version sắp deprecate trong vòng 90 ngày.

**Compliance webhook bắt buộc**
- `customers/data_request`, `customers/redact`, `shop/redact`.
- Trả 2xx; trả **401 nếu HMAC sai**; xử lý trong vòng 30 ngày.
- `shop/redact` đến 48 giờ sau khi gỡ app: **xoá index và analytics của shop**.

**Protected customer data**
- App chỉ dùng dữ liệu sản phẩm là Level 0.
- Nếu lưu analytics gắn với `logged_in_customer_id`, cần Level 1/2 [SL]. → **Analytics nên ẩn danh.**

**API version:** 2026-10 là stable mới nhất; 2027-01 là RC.

---

## 7. Lựa chọn search engine (cho app mới)

| Tiêu chí | **Typesense** (v30.x) | Meilisearch | OpenSearch/Elasticsearch | Postgres FTS + pgvector |
|---|---|---|---|---|
| Typo, facet, sort, synonym | Có sẵn | Có sẵn | Có (cấu hình nhiều) | Tự làm, facet chậm |
| Curation / pin | Có (overrides) | Hạn chế | Tự làm (pinned query) | Tự làm |
| Đa tenant | **Scoped API key** theo bản ghi | Tenant token | Index hoặc alias | Theo `shop_id` |
| Vector / hybrid | Có, kèm embedding tích hợp | Có | Có | Có |
| RAG / hội thoại | **Có sẵn** | — | — | Tự làm |
| Vận hành | Nhẹ, C++, cluster Raft | Nhẹ | Nặng | Đơn giản nhất |

**Khuyến nghị: Typesense** (self-host hoặc Typesense Cloud).
- Có collection alias để **swap không downtime** khi full re-index.
- Có overrides cho merchandising, multi-search cho autocomplete gộp product, collection và page.
- Đủ hybrid search cho giai đoạn AI.
- Bọc sau một interface `SearchEngine` để có thể đổi sang engine khác.

---

## 8. Currency và giá theo market

### 8.1 Vấn đề
- Bulk operation và webhook của Admin API trả giá theo **currency gốc của shop**. Index của app cũng lưu giá này.
- Khách ở market khác lại phải thấy **currency của mình và đúng giá của market đó**. Giá này có thể đến từ:
  - quy đổi tự động theo tỷ giá kèm làm tròn của Shopify;
  - điều chỉnh % theo market;
  - **giá cố định trong price list** của market.
- Không thể tự tính lại cho đúng ở client.
- Các đối thủ xử lý chưa tốt:
  - Searchanise phải index thêm giá theo từng vùng, làm index phình và chậm.
  - Hướng dẫn tích hợp Shopify của Algolia nhân với `Shopify.currency.rate`, một object **Shopify không công bố**, và có thể bị gỡ bất cứ lúc nào.
  - Search & Discovery thì **ẩn filter giá** khi khách dùng currency không phải mặc định. [XN]

### 8.2 Giải pháp: Storefront API, 1 request cho cả trang kết quả [XN]
- Search API của app trả **danh sách ID sản phẩm** của trang hiện tại (≤ 48). JS gọi **một** query `nodes(ids:)` tới Storefront API, kèm `@inContext(country:, language:)`.
  - `nodes` nhận **tối đa 250 ID** trong một request.
- `@inContext(country:)` trả `price`, `priceRange`, `compareAtPriceRange` **theo currency của market**.
  - Nó cũng **loại các sản phẩm không publish cho country đó** (node trả `null`). Nhờ vậy app lọc luôn được sản phẩm không bán ở market của khách.
  - Điều kiện: currency của country phải được bật trong cài đặt thanh toán của shop. Nếu chưa bật, Shopify trả về currency gốc.
- **Tokenless access** (không cần token):
  - Được dùng: Products, Collections, Search, Pages, Blogs, Cart.
  - **Không được dùng:** metafield, product tag, metaobject, customer. Query lấy giá không cần những thứ này.
  - **Giới hạn complexity 1.000** mỗi query.
  - Buyer traffic không có giới hạn request/phút cố định.
- Endpoint: `POST https://{shop}.myshopify.com/api/2026-10/graphql.json`.
  - Gọi same-origin (`/api/2026-10/graphql.json` trên domain của storefront) thì tránh được CORS và DNS lookup, nhưng **chưa thấy tài liệu xác nhận** [CHƯA XN], cần test.
- Lấy context ngay trong Liquid, không tốn request: `localization.country.iso_code`, `request.locale.iso_code`, `cart.currency.iso_code`.

```graphql
query Prices($ids: [ID!]!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
  nodes(ids: $ids) {
    ... on Product {
      id
      availableForSale
      priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      compareAtPriceRange { maxVariantPrice { amount currencyCode } }
    }
  }
}
```

  Không lấy `variants(first:N)` trong query này, vì sẽ đội complexity (48 × N). Giá của từng variant chỉ lấy khi khách mở quick view.

### 8.3 Filter và sort theo giá ở currency địa phương
- Index chỉ lưu giá gốc, nên khoảng giá (slider) cần quy đổi.
- **Phương án A (MVP):**
  - Tỷ lệ quy đổi = giá địa phương ÷ giá gốc, tính **từ chính response Storefront ở trên**. Không cần thêm request, không dùng object không công bố.
  - Đổi khoảng giá khách chọn về currency gốc rồi mới filter.
  - Đúng với quy đổi theo tỷ giá và với điều chỉnh %. Chỉ lệch nhẹ ở biên do làm tròn.
- **Phương án B (cho market có price list giá cố định):**
  - Khi sync, index thêm `price_min_{CC}` cho từng market đang active bằng Admin API `ProductVariant.contextualPricing(context: { country })`.
    - Input `ContextualPricingContext` có `country`, `companyLocationId`, `locationId`. Từ API 2025-04 chỉ tính các market đang active.
  - Filter và sort chạy trên trường đó. Cách này tốn thêm thời gian sync, nên chỉ bật khi shop thật sự có price list.
  - Field trả về của `ProductVariantContextualPricing` cần kiểm tra lại trước khi code [CHƯA XN].
- **B2B:** muốn có giá theo công ty, `@inContext(buyer:)` cần `customerAccessToken` cùng `companyLocationId`, mà theme không có sẵn → ngoài phạm vi MVP.

Nguồn:
- https://shopify.dev/docs/api/storefront/latest (phần Authentication và `@inContext`)
- https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/markets/international-pricing
- https://shopify.dev/docs/api/storefront/latest/queries/nodes
- https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ContextualPricingContext
- https://support.algolia.com/hc/en-us/articles/4406449523345--Shopify-How-do-I-enable-Shopify-multi-currency-support

---

## 9. Trọng số trường, sorting và API cho developer ở các đối thủ

**Trọng số và trường tìm kiếm**
- Searchanise: merchant chọn trường nào được tìm; schema có `weight` cho từng thuộc tính; title và SKU nặng nhất, description nhẹ nhất. [XN]
- Globo: có "relevance settings". [XN]
- Typesense hỗ trợ `query_by_weights` (0–127) và `num_typos` theo từng trường **lúc query**. Merchant đổi trọng số là có hiệu lực ngay, không cần re-index. [XN]
  - Typesense cũng có `prioritize_exact_match` và `text_match_type` (`max_score` / `max_weight` / `sum_score`).

**Sorting**
- Searchanise `sortBy` có: relevance, title, created, price, discount, reviews, sales_amount. [XN]
- Storefront API `ProductSortKeys` có `BEST_SELLING`, `CREATED_AT`, `PRICE`, `TITLE`, `RELEVANCE`… [XN]
  - Có thể lấy thứ tự best-selling của Shopify mà **không cần đọc order**, tránh phải xin quyền Protected Customer Data.
  - Boost thì phải dựng một collection ẩn "Boost All".
- Typesense cho tối đa **3 trường sort** mỗi query, có `_text_match` và `_eval(...)` (ví dụ đẩy sản phẩm hết hàng xuống). [XN]
- Thứ tự thủ công của collection không có webhook, nên các đối thủ đều phải sync tay. Events `collection.sortOrder` / `collection.products` là cơ hội làm tốt hơn.

**API cho developer**
- Searchanise: Search API công khai (`/getresults`, `/getwidgets`) cùng Widgets JS API (object `Searchanise`). [XN]
- Boost: REST storefront API có tài liệu, kèm JS SDK `widget-integration` (cache, trả JSON hoặc HTML template). [XN]
- Globo: không thấy API công khai. [XN]
- → Một **SDK có version, có event và template, có tài liệu** là điểm khác biệt rõ cho agency và theme dev.

Nguồn: https://typesense.org/docs/30.1/api/search.html · https://shopify.dev/docs/api/storefront/latest/enums/ProductSortKeys · https://docs.searchanise.io/search-api/ · https://developers.boostcommerce.io/library/packages/widget-integration-(client)/widget-integration.filterapi

---

## Nguồn

**Shopify (chính thức)**
- https://shopify.dev/docs/apps/launch/built-for-shopify/requirements
- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- https://github.com/Shopify/shopify-app-template-react-router · wiki "Upgrading-from-Remix"
- https://shopify.dev/docs/api/shopify-app-react-router
- https://shopify.dev/docs/apps/build/authentication-authorization/app-installation
- https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-public-apps-april-1-2026
- https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration
- https://shopify.dev/docs/api/app-home · https://shopify.dev/docs/api/app-home/apis/app
- https://shopify.dev/docs/apps/build/app-home/polaris2 · https://shopify.dev/changelog/posts/polaris-cdn-2-0-is-now-stable
- https://shopify.dev/docs/api/usage/bulk-operations/queries
- https://shopify.dev/docs/apps/build/webhooks/subscribe
- https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits
- https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
- https://shopify.dev/docs/apps/build/online-store/script-tag-deprecation/storefront
- https://shopify.dev/docs/apps/build/online-store/app-proxies
- https://shopify.dev/docs/storefronts/themes/navigation-search/search
- https://shopify.dev/docs/api/ajax/reference/predictive-search
- https://shopify.dev/docs/api/storefront/latest/queries/search
- https://shopify.dev/docs/apps/build/marketing-analytics/build-web-pixels
- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- https://shopify.dev/docs/apps/launch/protected-customer-data
- https://shopify.dev/docs/api/usage/versioning
- https://shopify.dev/docs/agents · https://shopify.dev/docs/agents/catalog/storefront-catalog · https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting
- https://shopify.dev/docs/apps/build/storefront-mcp/build-storefront-ai-agent
- https://github.com/Shopify/shop-chat-agent
- https://help.shopify.com/en/manual/online-store/search-and-discovery/filters

**Searchanise**
- https://apps.shopify.com/searchanise · https://searchanise.io/pricing/
- https://docs.searchanise.io/how-searchanise-works-shopify/ · /how-our-search-works/ · /search-api/ · /update-api/ · /api/
- https://docs.searchanise.io/real-time-sync-on-shopify · /indexing-shopify/ · /shopify-markets/
- https://docs.searchanise.io/404-error-on-search-results-page-shopify/ · /widget-doesnt-appear-on-page-load-shopify/

**Globo**
- https://apps.shopify.com/product-filter-and-search · https://globo.io/smart-product-filter-search
- https://docs.globo.io/getting-started/sync-product-data.md · /getting-started/integrate-app-to-theme.md
- https://docs.globo.io/search/enable-instant-search-widget.md

**Boost và nguồn khác**
- https://support.boostcommerce.net/en/articles/9366927-for-dev-boost-ai-search-discovery-api
- https://support.boostcommerce.net/en/articles/9393598-sync-faqs
- https://craftshift.com/best-shopify-search-filter-apps-2026/ (roundup, có thể thiên lệch)
- https://idukki.io/blog/shopify-webmcp-free-agent-api-what-it-still-doesnt-do (blog vendor)
- https://typesense.org/docs/overview/features.html
