# Kế hoạch triển khai — Shopify Search & Filter app

> File dành cho Claude (và dev) làm việc theo. Đọc `docs/01-RESEARCH.md` trước, vì mọi quyết định ở đây đều dựa trên nó.
> Mỗi task có checkbox `[ ]` và **tiêu chí hoàn thành (DoD)**. Làm xong thì tick `[x]` và ghi ngắn vào phần "Nhật ký" ở cuối file.
> Mục tiêu dài hạn: đạt **Built for Shopify (BFS)**. Mọi màn hình và mọi tích hợp đều phải tuân theo checklist BFS ở mục 11.

---

## 1. Mục tiêu và phạm vi

**Sản phẩm.** App public trên Shopify App Store, gồm:
1. **Instant search:** dropdown autocomplete gồm sản phẩm, collection, page và từ khoá gợi ý.
2. **Trang kết quả tìm kiếm** có filter, sort và phân trang.
3. **Filter cho trang collection.**
4. **Cấu hình search:** bật/tắt và đặt **trọng số** cho từng trường tìm kiếm (title, description, SKU, vendor, tag…).
5. **Cấu hình sorting:** bật/tắt, đổi tên, sắp thứ tự các kiểu sort; sort mặc định riêng cho trang search và cho từng collection.
6. **Hiển thị giá đúng currency và market** bằng Storefront API: **1 request cho cả trang kết quả**.
7. **Merchandising:** synonym, stop word, redirect, pin/boost/bury, loại trừ sản phẩm.
8. **Analytics:** top query, zero-result, CTR, mức dùng filter.
9. **API cho storefront developer:** JS SDK, JSON API, event, template, để theme dev **tự làm section riêng** dùng dữ liệu của app.

**Ngoài phạm vi MVP:** chat AI, cá nhân hoá, visual search, recommendation, Year/Make/Model, giá B2B.

**Đối thủ cần vượt:**
- Sync nhanh và minh bạch.
- Không phá theme.
- Không làm trắng trang khi engine lỗi.
- Giá đúng ở mọi market.
- Giảm Lighthouse ≤ 5 điểm. Ngưỡng BFS là 10, mục tiêu của ta nghiêm hơn.

---

## 2. Quyết định kiến trúc (ADR rút gọn)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | **Shopify React Router v7 template** (`shopify-app-template-react-router`, `@shopify/shopify-app-react-router@^4`), TypeScript, Node 22 | Shopify đã gộp Remix vào React Router. Template Remix chỉ còn dành cho app cũ. **Pin `react-router@7.x`, không lên v8.** |
| D2 | **Polaris web components 2.x** cùng App Bridge CDN. **Không dùng `@shopify/polaris` (React).** | Polaris React đã bị deprecate. BFS yêu cầu Polaris 2 trước 01/05/2027. |
| D3 | **PostgreSQL** + Prisma | SQLite chỉ chạy được một instance. |
| D4 | **Redis + BullMQ** cho hàng đợi sync và cache | Debounce, retry, rate limit theo shop. |
| D5 | **Typesense**, bọc sau interface `SearchEngine` | Có sẵn typo, facet, synonym, override, alias swap; `query_by_weights` (0–127) cho phép **đổi trọng số khi query mà không phải re-index**. |
| D6 | **Mỗi shop một collection** `p_{shopId}_v{n}`, truy cập qua alias `p_{shopId}` | Cô lập dữ liệu, re-index không downtime, xoá sạch khi nhận `shop/redact`. |
| D7 | **Webhook qua Google Pub/Sub** (dev dùng HTTPS). Mọi webhook đi vào queue, rồi **lấy lại dữ liệu mới nhất qua GraphQL** | Không phụ thuộc thứ tự hay payload cũ; tránh timeout 5 giây. |
| D8 | **Events API** (`Collection`: `collection.products`, `collection.sortOrder`) | Bắt thay đổi thành viên và kiểu sắp xếp collection mà webhook bỏ sót. Smart collection cần test (task 1.8); lưới an toàn vẫn là poll đối soát. |
| D9 | **Search API riêng** (`services/search-api`, Hono), deploy tách khỏi admin, có CDN cache | Độ trễ thấp; traffic storefront không ảnh hưởng admin. |
| D10 | Storefront chỉ dùng **theme app extension**: 1 app embed + 2 app block | ScriptTag đã chết. BFS cấm ghi Asset API. |
| D11 | **Render progressive**: block in sẵn kết quả native bằng Liquid (fallback và SEO), JS hydrate bằng API của app | Không ẩn grid theme theo hàng trăm selector như Globo. Engine lỗi vẫn có sản phẩm. Giảm CLS. |
| D12 | **Billing qua Shopify managed pricing**, tính theo số sản phẩm | Theo chuẩn App Store. |
| D13 | **Analytics ẩn danh** | Giữ Protected Customer Data ở Level 0. |
| D14 | API version **2026-10** (cấu hình một chỗ) | Cần cho Collection model mới; nâng version theo quý. |
| D15 | **Giá hiển thị lấy từ Storefront API**: một query `nodes(ids:)` với `@inContext(country, language)` cho cả trang. Index chỉ lưu giá gốc để filter/sort; khoảng giá được quy đổi bằng tỷ lệ suy ra từ chính response đó. | Đúng mọi kiểu giá market (tỷ giá, điều chỉnh %, price list). Tự lọc sản phẩm không bán ở market. Không dùng `Shopify.currency.rate` (không công bố). Xem RESEARCH mục 8. |
| D16 | **Storefront SDK công khai** (`window.SearchApp`): JSON API, event, template, có semver, có tài liệu | Theme dev tự làm section custom mà không cần fork widget; giảm ticket support "sửa theme". |
| D17 | **Best-selling tính từ order 60 ngày gần nhất** qua optional scope `read_orders`; fallback Storefront `BEST_SELLING` | Merchant kiểm soát được; chỉ cần Protected Customer Data Level 1, không cần `read_all_orders` hay ShopifyQL (Level 2). Chỉ lưu orderId, productId, qty. |

Muốn đổi một quyết định thì ghi lý do vào "Nhật ký" và cập nhật bảng này.

---

## 3. Cấu trúc repo

```
search-app/
├─ app/                              # React Router app (admin + webhook + events)
│  ├─ shopify.server.ts              # shopifyApp({... apiVersion: October26, expiringOfflineAccessTokens })
│  ├─ routes/
│  │  ├─ app.tsx                     # layout: AppProvider + <s-app-nav>
│  │  ├─ app._index.tsx              # Home: setup checklist, embed status, sync status, KPI
│  │  ├─ app.search.tsx              # Searchable fields: bật/tắt + trọng số + typo + test search
│  │  ├─ app.sorting.tsx             # Sort options: bật/tắt, nhãn, thứ tự, mặc định
│  │  ├─ app.filters.tsx             # Filter tree builder
│  │  ├─ app.merchandising.*.tsx     # synonyms, redirects, rules, stopwords
│  │  ├─ app.appearance.tsx          # Widget styling + LIVE PREVIEW cạnh editor
│  │  ├─ app.analytics.tsx
│  │  ├─ app.developers.tsx          # Public key, link tài liệu SDK/API, ví dụ section
│  │  ├─ app.sync.tsx
│  │  ├─ app.plans.tsx
│  │  ├─ webhooks.*.tsx              # KHÔNG nằm dưới layout app.tsx
│  │  └─ api.events.*.tsx            # Events API endpoints
│  └─ lib/
│     ├─ shopify/                    # GraphQL client biết throttle, queries
│     ├─ sync/                       # bulk runner, JSONL parser, mapper Product→Doc
│     ├─ search/                     # SearchEngine + TypesenseEngine, query builder
│     ├─ config/                     # schema zod cho SearchSettings/SortOption/FilterSet (dùng chung admin + API)
│     ├─ merch/
│     └─ billing/
├─ workers/                          # BullMQ processors (process riêng)
├─ services/search-api/              # Public storefront API (Hono), stateless
├─ packages/
│  ├─ storefront-sdk/                # window.SearchApp: client, state, events, pricing (Storefront API)
│  └─ storefront-ui/                 # widget mặc định (instant search, results, filters), xây trên SDK
├─ extensions/
│  ├─ search-theme/
│  │  ├─ blocks/app-embed.liquid     # app embed: config JSON + SDK + instant search
│  │  ├─ blocks/search-results.liquid
│  │  ├─ blocks/collection-filter.liquid
│  │  ├─ snippets/sa-config.liquid   # in JSON context: shop, country, locale, currency, money format
│  │  ├─ assets/                     # bundle build từ packages/*
│  │  └─ locales/
│  └─ search-pixel/                  # web pixel
├─ docs/
│  ├─ 01-RESEARCH.md · 02-PLAN.md · adr/
│  └─ developers/                    # tài liệu công khai SDK + API + ví dụ section (xuất bản lên site docs)
├─ prisma/schema.prisma
├─ shopify.app.toml
└─ docker-compose.yml                # postgres, redis, typesense
```

---

## 4. Mô hình dữ liệu

### 4.1 Prisma (PostgreSQL)

- **`Session`** — lấy theo template; phải có `refreshToken` và `refreshTokenExpires`.
- **`Shop`** gồm:
  - Định danh: `id`, `domain`, `plan`, `installedAt`, `uninstalledAt?`, `publicKey` (cho SDK)
  - Cấu hình index: `currency`, `primaryLocale`, `locales[]`
  - Markets: `markets` (JSON: handle, country[], currency, `hasFixedPrices`)
  - Engine: `searchKeyScoped`, `indexAlias`, `indexVersion`
  - Sync: `syncState`, `lastFullSyncAt`, `lastIncrementalAt`, `productCount`
- **`SyncJob`**: `id`, `shopId`, `type` (FULL | INCREMENTAL | RECONCILE), `status`, `bulkOperationId?`, `stats`, `error?`, `startedAt`, `finishedAt`
- **`SearchSettings`** (1-1 với Shop):
  - **`fields`**: JSON[], cấu hình theo từng trường (xem 4.3)
  - `typoTolerance` (OFF | LOW | NORMAL), `minWordLengthFor1Typo`, `minWordLengthFor2Typo`
  - `prioritizeExactMatch`, `matchMode` (`max_score` | `sum_score`)
  - `showOutOfStock` (SHOW | HIDE | PUSH_DOWN), `excludeTags[]`, `variantAsProduct`
  - `searchTypes` (products / collections / pages / articles, mỗi loại bật/tắt cho autocomplete và trang kết quả)
- **`SortOption`**: `id`, `shopId`, `key` (xem 4.4), `label` (JSON theo locale), `enabled`, `position`
- **`SortDefault`**: `shopId`, `scope` (SEARCH | COLLECTION_DEFAULT | COLLECTION), `collectionId?`, `sortKey`
- **`FilterSet`**: `id`, `shopId`, `scope` (DEFAULT | COLLECTION | SEARCH), `collectionId?`, `items` (JSON[]), `updatedAt`
- **`Synonym`**, **`Redirect`**, **`MerchRule`**, **`StopWord`** — như trước
- **`Appearance`**: `shopId`, `tokens`, `texts`, `templates` (JSON: HTML template của card khi merchant override)
- **`AnalyticsDaily`**: `shopId`, `date`, `query`, `searches`, `zeroResults`, `clicks`, `addToCarts`, `revenueShopCurrency`
- **`WebhookReceipt`**: `webhookId` (unique), `topic`, `shopId`, `receivedAt` (TTL 7 ngày)

### 4.2 Document trong Typesense (`p_{shopId}`)

```ts
type ProductDoc = {
  id: string; gid: string;                         // gid để gọi Storefront nodes()
  handle: string; title: string; vendor: string; product_type: string;
  tags: string[]; collections: string[]; collection_titles: string[];
  description_text: string;                        // HTML đã strip, cắt ~2k ký tự
  skus: string[]; barcodes: string[];
  variant_titles: string[]; options: Record<string, string[]>;  // opt_Size, opt_Color
  // Giá: currency gốc của shop, minor units. CHỈ dùng cho filter/sort; giá hiển thị lấy từ Storefront API.
  price_min: number; price_max: number;
  compare_at_max?: number; discount_pct: number; on_sale: boolean;
  price_min_{CC}?: number;                          // chỉ khi market có price list cố định (phương án B)
  available: boolean; inventory_total: number;
  image: string; image_alt?: string; image_2?: string;
  created_at: number; published_at: number; updated_at: number;
  best_selling_rank?: number;                       // từ order
  pos_{collectionId}?: number;                      // thứ tự thủ công trong collection (field động pos_.*)
  mf_*: string | number | boolean | string[];       // metafield được chọn để search/filter/sort
  variants_json: string;                            // chỉ lưu, không index
  // Đa ngôn ngữ: title_{locale}, description_{locale}, tags_{locale}
};
```

Thêm collection `c_{shopId}` cho collection, page và article (dùng trong autocomplete và tab kết quả).

### 4.3 Cấu hình trường tìm kiếm (`SearchSettings.fields`)

```ts
type SearchField = {
  key: "title" | "description" | "vendor" | "product_type" | "tags" | "sku" | "barcode"
     | "variant_titles" | "options" | "collection_titles" | `mf:${string}.${string}`;
  enabled: boolean;
  weight: number;            // 1–10 trên UI → map sang 0–127 cho query_by_weights
  typo: boolean;             // tắt typo cho SKU/barcode
  prefix: boolean;           // tìm theo tiền tố (autocomplete)
  exactOnly?: boolean;       // SKU khớp chính xác hoặc một phần
};
```

**Mặc định:**

| Trường | Bật | Trọng số | Typo | Prefix | Ghi chú |
|---|---|---|---|---|---|
| title | ✓ | 10 | ✓ | ✓ | |
| sku | ✓ | 9 | ✗ | ✓ | |
| vendor | ✓ | 6 | ✓ | ✓ | |
| product_type | ✓ | 6 | ✓ | ✓ | |
| tags | ✓ | 5 | ✓ | ✓ | |
| variant_titles / options | ✓ | 4 | ✓ | ✓ | |
| collection_titles | ✗ | 3 | ✓ | ✓ | |
| description | ✓ | 2 | ✓ | ✗ | |
| barcode | ✗ | 8 | ✗ | ✗ | |
| metafield | ✗ | 3 | ✓ | ✗ | merchant chọn từ danh sách definitions |

**Cơ chế:**
- Bật/tắt trường và đổi trọng số **có hiệu lực ngay**. API dựng `query_by`, `query_by_weights`, `num_typos`, `prefix` theo từng trường từ config; config được cache trong Redis.
- **Thêm một metafield mới** làm trường search cần re-index, vì phải đưa field vào document. UI phải báo rõ và tự lên lịch sync.

### 4.4 Sort options (`SortOption.key`)

| key | Typesense `sort_by` | Ghi chú |
|---|---|---|
| `relevance` | `_text_match:desc, <tie-break>` | Chỉ có nghĩa khi có `q`; tie-break theo cấu hình (best-selling hoặc mới nhất) |
| `manual` | `pos_{collectionId}:asc` | Chỉ có trên collection: thứ tự merchant tự sắp trong admin Shopify |
| `best_selling` | `best_selling_rank:asc` | Nguồn hạng: order 60 ngày gần nhất (`read_orders`, task 2.15); chưa được cấp quyền thì dùng Storefront `BEST_SELLING` (task 1.12) |
| `price_asc` / `price_desc` | `price_min:asc` / `price_min:desc` (hoặc `price_min_{CC}`) | Thứ tự không đổi khi quy đổi theo tỷ lệ; dùng field theo market nếu có price list |
| `created_desc` / `created_asc` | `published_at:desc` / `:asc` | |
| `title_asc` / `title_desc` | `title_sort:asc` / `:desc` | Field `title_sort` dạng string có `sort: true` |
| `discount_desc` | `discount_pct:desc` | |
| `available_first` | `_eval(available:true):desc` cộng với sort đang chọn | Dùng cho chế độ "đẩy hết hàng xuống cuối", không phải lựa chọn của khách |
| `mf:<ns.key>:asc\|desc` | `mf_ns_key:asc\|desc` | Metafield kiểu số hoặc ngày, merchant tự thêm |

**Quy tắc:**
- Typesense cho tối đa **3 trường sort** mỗi query. Query builder ghép: (1) đẩy sản phẩm hết hàng xuống nếu bật, (2) sort chính, (3) tie-break.
- `pos_{collectionId}` là field động dạng `pos_.*` (int32). Sync nó từ `collection.products` có sắp theo `COLLECTION_DEFAULT`, và cập nhật lại khi Event `collection.sortOrder` hoặc `collection.products` bắn.
  - Với shop có rất nhiều collection, phải đo dung lượng document trước khi chốt (task 1.13). Phương án dự phòng: lưu thứ tự riêng và dùng `pinned_hits` theo trang.
- Sort mặc định: trang search mặc định `relevance`. Trang collection mặc định lấy theo `sortOrder` của collection trong Shopify, và merchant được ghi đè theo từng collection (`SortDefault`).
- Nhãn sort dịch theo locale; thứ tự hiển thị theo `position`.

---

## 5. Thiết kế Sync

> **Nguyên tắc: full sync chỉ chạy khi cài app, khi schema đổi (thêm trường metafield), hoặc khi đối soát phát hiện lệch lớn. Ngày thường chỉ sync phần thay đổi (delta).** Không chạy full re-index hằng đêm như các đối thủ. Chi tiết và lý do ở RESEARCH mục 10.

**5.1 Full sync nhanh** (mục tiêu **30k sản phẩm ≤ 3–5 phút**, cần benchmark)
1. Tạo collection mới `p_{shopId}_v{n+1}`; schema dựng từ `SearchSettings`, `FilterSet` và `SortOption`.
2. **Bulk dạng phẳng, chạy song song** (tối đa 5 bulk mỗi shop từ API 2026-01). Không lồng connection:
   - (a) `products`: chỉ field cấp product. **Metafield lấy bằng alias `mf_x: metafield(namespace:"…", key:"…") { value type }`** cho đúng những key đã cấu hình, không dùng connection `metafields`. Nhờ vậy số dòng JSONL ít hơn nhiều.
   - (b) `productVariants` ở top-level, có field `product { id }`, chỉ lấy field cần dùng.
   - (c) `collections` + `products { id }` (kèm thứ tự để tính `pos_*`).
   - (d), (e) **Chia nhỏ (shard)** (a) hoặc (b) theo khoảng `created_at` khi catalog lớn (> 50k), để các shard chạy song song.
   - Để `groupObjects: false` (mặc định từ 2026-01). Shopify không đảm bảo dòng con nằm sau dòng cha, nên **join theo ID ở bước 4, không dựa vào thứ tự dòng**.
3. Chờ webhook `bulk_operations/finish` của từng bulk, poll `bulkOperation(id:)` làm dự phòng.
4. Mỗi file **tải về và stream-parse ngay khi bulk của nó xong**, không đợi các bulk khác. Ghi tạm vào bảng staging (Redis hash hoặc Postgres `UNLOGGED`) theo `productId`. Khi đủ (a), (b), (c) thì ghép lại, map sang `ProductDoc`, rồi import theo batch 1.000, chạy song song 2–4 luồng.
5. **Có kết quả search sớm:** trong lúc chờ bulk, chạy một lượt GraphQL thường cho khoảng 1–2k sản phẩm đầu (`collection.products(sortKey: BEST_SELLING)` của collection all, hoặc `products(first:250)` vài trang). Nhờ vậy shop mới cài có search dùng được sau khoảng 30–60 giây. Home hiện "Đang index: x/y".
6. Bản dịch và giá theo market (phương án B, mục 6.3) chạy thành **bulk phẳng riêng, song song** với (a)–(c) khi còn slot. Không có slot thì chạy sau swap: search vẫn dùng được bằng ngôn ngữ và giá gốc, rồi cập nhật bổ sung.
7. Kiểm tra: số document xấp xỉ số product published. Đạt thì **swap alias**; không đạt thì giữ alias cũ và đánh dấu ERROR.
8. Sự kiện incremental đến trong lúc full sync được ghi vào cả hai collection, hoặc buffer rồi phát lại sau khi swap.

**5.2 Incremental sync**
- Webhook và Event vào hàng đợi `incremental`, khoá theo `shopId:productId`, debounce 3–5 giây.
- Nếu Event đã kèm sẵn dữ liệu (subscription có `query`, tối đa 100 điểm) và `updated_at` mới hơn document thì dùng luôn, không gọi lại API.
- Còn lại: gom các ID sau khoảng debounce, gọi **`nodes(ids:)`** theo lô 20–50 sản phẩm (giữ dưới 1.000 điểm mỗi query) để lấy bản mới nhất, **kèm `collections`**:
  - Không còn, không active, hoặc chưa publish lên Online Store → xoá document.
  - Ngược lại → upsert.
- Cách xử lý theo nguồn sự kiện:
  - `products/delete` → xoá ngay.
  - `inventory_levels/update` → tra variant rồi product, xếp hàng product đó.
  - Collection hoặc Event `collection.products` / `collection.sortOrder` → cập nhật `collections` và `pos_{id}` của các product bị ảnh hưởng.
- Dedupe bằng `X-Shopify-Webhook-Id`; bỏ sự kiện cũ bằng cách so `X-Shopify-Triggered-At` với `updated_at`.

- **Có đột biến** (hàng đợi của shop vượt khoảng 2.000 ID, ví dụ do import CSV): chuyển sang **delta bulk** `products(query:"updated_at:>'T'")` thay cho gọi từng lô. Cách này không tốn rate limit.

**5.3 Đối soát chỉ sync phần thay đổi (thay cho full re-index hằng đêm)**
- **Mỗi 5 phút:** `products(query:"updated_at:>'{watermark − 2 phút}'", sortKey: UPDATED_AT)` phân trang. Có hơn 2.000 kết quả thì chuyển sang delta bulk.
- **Mỗi đêm (checksum):**
  1. Chạy một bulk siêu nhẹ `products { id updatedAt }` (30k dòng, dự kiến < 1 phút).
  2. So với `id` và `updated_at` trong index.
  3. Lấy lại **chỉ** những ID lệch hoặc thiếu, xoá những ID thừa.
  - Làm tương tự cho `collections { id updatedAt }` và thành viên collection.
- **Full sync** chỉ khi: mới cài, schema đổi, hoặc lệch quá 2% sau checksum.
- Watermark (`lastSyncedUpdatedAt`) lưu theo từng shop.

**5.4 Gỡ cài và quyền riêng tư**
- `app/uninstalled`: dừng job, xoá session, giữ index 48 giờ.
- `shop/redact`: xoá index và mọi dữ liệu của shop.
- `customers/*`: trả 200 và ghi log.

**5.5 Hiển thị cho merchant:** thời điểm sync cuối, số đã index so với tổng, job đang chạy, lỗi kèm cách sửa, nút "Sync now".

---

## 6. Search API, Currency và Developer API

### 6.1 Endpoint (base `https://search.<domain>/v1`; xác thực bằng `shop` + `publicKey`; bật CORS cho domain của shop)

| Endpoint | Mô tả |
|---|---|
| `GET /suggest?q=&locale=&limit=` | Autocomplete gồm product, collection, page và gợi ý. p95 < 80ms ở server. |
| `GET /search?q=&filters=&sort=&page=&per_page=&locale=&fields=` | Kết quả, facet (count, và min/max cho giá), `sort_options`, `applied_filters`, `redirect`. |
| `GET /collection?collection=&filters=&sort=&page=&per_page=` | Filter trong collection. |
| `GET /config?locale=` | Cấu hình public mà SDK cần: filter tree, sort options đã bật kèm nhãn, sort mặc định, text, appearance tokens. Cache 5 phút; purge khi merchant lưu. |
| `POST /events` | Beacon analytics. |

**Response (rút gọn)**

```json
{
  "query": "red dress", "corrected_query": null, "redirect": null,
  "total": 132, "page": 1, "per_page": 24,
  "sort": "relevance",
  "sort_options": [{"key":"relevance","label":"Liên quan"},{"key":"price_asc","label":"Giá tăng dần"}],
  "products": [{ "id":"123", "gid":"gid://shopify/Product/123", "handle":"...", "title":"...",
                 "vendor":"...", "image":"...", "image_2":"...", "available":true,
                 "price_min":19900, "price_max":25900, "compare_at_max":29900,
                 "currency":"USD", "variants":[...], "badges":["sale"] }],
  "facets": [{ "key":"vendor","label":"Thương hiệu","type":"checkbox","values":[{"value":"Nike","count":12,"selected":false}] },
             { "key":"price","type":"range","min":5000,"max":120000,"currency":"USD" }]
}
```

- `fields=` cho phép SDK yêu cầu bớt field để response nhẹ hơn.
- Giá trong response là **giá gốc** (`currency` = currency của shop), dùng cho fallback. Giá hiển thị lấy theo mục 6.3.

**Pipeline query:**
1. Chuẩn hoá.
2. Kiểm tra redirect.
3. Dựng `query_by` / `weights` / `num_typos` từ `SearchSettings.fields`.
4. Stop word và synonym.
5. Merch override (pin/hide/boost).
6. Lọc hoặc đẩy xuống sản phẩm hết hàng.
7. `sort_by` (mục 4.4).
8. Facet.

**Bảo mật và hiệu năng**
- Mỗi shop có Typesense scoped key.
- Rate limit theo IP và theo shop.
- `Cache-Control: public, max-age=30, stale-while-revalidate=300` kèm CDN; purge theo tag `shop`.
- Engine lỗi thì trả **503** để client giữ kết quả native.

### 6.2 Currency: luồng xử lý (D15)

```
Liquid (app embed) ── in sẵn context: shop, country=localization.country.iso_code,
                      language=request.locale.iso_code, currency=cart.currency.iso_code,
                      moneyFormat ({{ 0 | money }} và money_with_currency mẫu), shopCurrency
        │
        ▼
SDK gọi /v1/search  ──►  danh sách sản phẩm (giá gốc) + gid
        │
        ├─ needsLocalPrice = (currency ≠ shopCurrency) || shop.markets có điều chỉnh giá cho country này
        │
        ▼  (nếu cần) MỘT request Storefront API cho cả trang
POST /api/2026-10/graphql.json  (tokenless)
  query Prices($ids:[ID!]!, $country:CountryCode, $language:LanguageCode)
    @inContext(country:$country, language:$language) {
    nodes(ids:$ids) { ... on Product { id availableForSale
      priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      compareAtPriceRange { maxVariantPrice { amount currencyCode } } } }
  }
        │
        ▼
Merge theo gid: thay giá; node null → ẩn sản phẩm (không bán ở market này);
format bằng moneyFormat của theme; lưu rate = localMin / baseMin (median của trang) để quy đổi filter giá
```

**Quy tắc chi tiết**
- **Một request mỗi trang:** `nodes` nhận tối đa 250 ID, một trang có ≤ 48 sản phẩm. **Không** lấy `variants(first:N)` trong query này, để giữ complexity thấp (tokenless tối đa 1.000). Giá từng variant chỉ lấy khi mở quick view hoặc chọn swatch (một request nhỏ khác).
- **Không gây CLS:** ô giá giữ chỗ cố định (min-width, skeleton). Khi `needsLocalPrice = false` thì render giá index ngay, bỏ qua request.
- **Autocomplete:** dùng cùng cơ chế (≤ 6 ID); có cache trong bộ nhớ theo `gid + country` trong session.
- **Endpoint:** ưu tiên same-origin `/api/2026-10/graphql.json` trên domain storefront. Nếu test không chạy thì dùng `https://{shop}.myshopify.com/api/2026-10/graphql.json` (task 2.7a).
- **Lỗi hoặc timeout (> 1.5s):** giữ giá gốc nhưng **ẩn số tiền**, hiện "Xem giá", để không bao giờ hiển thị sai currency. Ghi metric.
- **Khoảng giá (slider):**
  - Hiển thị: `min/max` của facet × `rate`.
  - Khi khách chọn khoảng: chia cho `rate` để đổi về currency gốc trước khi gửi `filters`.
  - Sort theo giá không bị ảnh hưởng.
  - Market có price list cố định: dùng `price_min_{CC}` (mục 6.3).
- **Analytics doanh thu** quy về currency của shop.
- **B2B** (`@inContext(buyer:)`) nằm ngoài MVP.

### 6.3 Giá theo market có price list cố định (phương án B, bật tự động)
- Khi sync `Shop.markets`, phát hiện market nào có giá cố định (`hasFixedPrices`). Cách phát hiện cụ thể cần kiểm tra Admin API Markets / PriceList trước khi code.
- Với các market đó, full sync chạy thêm pass `ProductVariant.contextualPricing(context:{country})` cho country chính của market, rồi ghi `price_min_{CC}`.
- Filter và sort theo giá ở market đó dùng field này. Hiển thị vẫn lấy từ Storefront API.
- **Trước khi code:** xác nhận các field trả về của `ProductVariantContextualPricing` và chi phí bulk.

### 6.4 Developer API cho custom section (D16)

**Mục tiêu:** theme dev hoặc agency tự viết **section Liquid riêng** (hoặc dùng widget mặc định nhưng thay template) mà vẫn dùng search, filter, sort, merchandising và giá theo market của app.

**(a) JS SDK `window.SearchApp`**
- Nạp từ app embed, **semver** `v1`.
- Sẵn sàng khi bắn event `searchapp:ready` hoặc `SearchApp.ready()` resolve.

```js
await SearchApp.ready();
const res = await SearchApp.search({ q: 'dress', filters: { vendor: ['Nike'], price: { min: 10, max: 50 } },
                                     sort: 'price_asc', page: 1, perPage: 24 });   // giá đã localize sẵn
const sug = await SearchApp.suggest('dre', { limit: 6 });
const col = await SearchApp.collection('summer', { filters, sort: 'manual' });
const cfg = await SearchApp.getConfig();          // filter tree, sortOptions (đã lọc enabled), texts
SearchApp.formatMoney(1999, 'EUR');               // theo moneyFormat của theme
SearchApp.track('click', { productId, position }); // analytics
SearchApp.state.get(); SearchApp.state.set({ filters, sort, page });  // đồng bộ URL (filter.p.*, sort_by, page)
SearchApp.on('results', (res) => {}); SearchApp.on('filters:change', ...); SearchApp.on('sort:change', ...);
SearchApp.mount(el, { type: 'results' | 'filters' | 'sort' | 'pagination' | 'instant', template: '#my-card' });
```

**(b) DOM events trên `document`** (cho code không dùng module)
- `searchapp:ready`, `searchapp:before-search`, `searchapp:results`, `searchapp:render`, `searchapp:filters-change`, `searchapp:sort-change`, `searchapp:error`.
- `detail` chứa payload. `before-search` cho phép sửa params, ví dụ ép filter.

**(c) Template ghi đè**
- Theme dev đặt `<template data-searchapp="product-card">…</template>` trong section của mình. Cú pháp placeholder tối giản, không `eval`:
  - Biến: `{{title}}`, `{{price}}`, `{{url}}`, `{{image | img_url: 400}}`
  - Điều kiện và lặp: `{{#if on_sale}}`, `{{#each badges}}`
- Có template cho: `product-card`, `filter-group`, `sort-select`, `pagination`, `empty`, `suggest-item`.
- Không có template thì dùng mặc định.

**(d) Headless / dùng ngoài theme**
- Các endpoint JSON ở 6.1 được công bố kèm `publicKey` (lấy ở trang **Developers** trong admin).
- Có giới hạn rate. Có OpenAPI spec trong `docs/developers/openapi.yaml`.

**(e) Thuộc tính khai báo** cho dev chỉ biết Liquid
- `<div data-searchapp-mount="results" data-per-page="24" data-sort="best_selling" data-collection="{{ collection.handle }}"></div>`
- SDK tự mount. Dùng được bên trong bất kỳ custom section nào.

**(f) Tài liệu**
- `docs/developers/`: quickstart, tham chiếu SDK, event, template, ví dụ 3 section mẫu (grid custom, filter ngang, sort dropdown riêng), changelog.
- Trang **Developers** trong admin link tới đó.
- **Cam kết tương thích:** chỉ break ở major version; deprecate trước ít nhất 90 ngày.

**(g) [Thử nghiệm, CHƯA XN]** Render card bằng Liquid của theme qua app proxy (`application/liquid` kèm `all_products[handle]`). Chỉ làm nếu cần SEO hoặc thẩm mỹ; `all_products` có giới hạn số handle mỗi trang.

---

## 7. Storefront (theme app extension)

**7.1 App embed** (target `body`)
- In `sa-config` (JSON context, mục 6.2).
- Nạp **SDK** (≤ 8 KB gzip) cùng **instant search** (≤ 10 KB gzip, lazy khi focus ô search).
- Bám vào `form[action*="/search"] input[name=q]` hoặc selector cấu hình. Dropdown `position: fixed`, không gây CLS. ARIA combobox, điều hướng bằng bàn phím.
- API lỗi thì Enter vẫn submit về `/search` native.

**7.2 App block `search-results` và `collection-filter`**
- Liquid render ngay grid native (SEO và fallback), rồi SDK hydrate trong vùng của block.
- Block settings trong theme editor:
  - Số cột, số sản phẩm mỗi trang.
  - Vị trí filter (trái / trên / drawer).
  - Hiện dropdown sort (bật/tắt).
  - Sort mặc định (lấy từ admin, cho ghi đè).
  - Kiểu card.
- Theme dev cũng có thể bỏ block này và dùng `data-searchapp-mount` trong section của họ (mục 6.4e).

**7.3 Web pixel:** `search_submitted`, `product_added_to_cart`, `checkout_completed` (ẩn danh).

**7.4 Ngân sách hiệu năng** (CI)
- Lighthouse mobile trên Horizon: giảm ≤ 5 điểm ở Home, Product và Collection.
- Request Storefront API giá không chặn render; tổng JS lần đầu ≤ 20 KB gzip.

---

## 8. Admin (App Home)

Polaris web components 2.x và App Bridge. Dữ liệu qua `loader`, ghi qua `action`. Mọi form có **Contextual Save Bar**.

**Nav:** Home · Search · Sorting · Filters · Merchandising · Appearance · Analytics · Settings (Sync, Developers, Plans, Help).

| Trang | Nội dung chính | Yêu cầu BFS |
|---|---|---|
| **Home** | Checklist setup (bật embed, thêm block, cấu hình search, sort, filter, xem trước) qua `shopify.app.extensions()`; card sync; KPI 7 ngày | 3.1.4, 4.2.2, 4.2.3, 4.2.5 |
| **Search** | Bảng trường tìm kiếm: mỗi dòng có **toggle bật/tắt**, **trọng số 1–10** (`s-number-field` hoặc slider tự ghép), typo, prefix; thêm trường metafield (chọn từ definitions); kiểu search (products/collections/pages/articles); typo tolerance; hết hàng (hiện / ẩn / đẩy xuống); loại trừ theo tag. **Ô "Thử tìm" xem kết quả ngay với cấu hình đang sửa, chưa cần lưu**, có giải thích vì sao sản phẩm xếp hạng như vậy. Có nút "Khôi phục mặc định". | Save Bar; báo rõ khi thay đổi cần re-index |
| **Sorting** | Danh sách sort option: toggle, đổi nhãn theo ngôn ngữ, kéo thả thứ tự; thêm sort theo metafield số hoặc ngày; sort mặc định cho trang search và cho collection; ghi đè theo collection (resourcePicker); tie-break cho relevance | Save Bar; option thiếu dữ liệu (best-selling khi chưa có order) bị disable kèm giải thích |
| **Filters** | Filter tree builder, ghi đè theo collection | Save Bar, lỗi inline |
| **Merchandising** | Synonyms, Redirects, Stop words, Rules | `s-table`, empty state, `s-modal` |
| **Appearance** | Token màu và layout **đặt cạnh live preview** | 4.2.6 |
| **Analytics** | Top queries, zero-result (tạo synonym hoặc redirect nhanh), filter usage, sort usage | — |
| **Developers** | Public key, endpoint, link docs SDK/API, đoạn mã mẫu copy được, bật/tắt headless API | — |
| **Sync** | Trạng thái, lịch sử, Sync now | — |
| **Plans** | Managed pricing, usage so với hạn mức | Không gây áp lực |

---

## 9. Tóm tắt các API nội bộ (admin, qua `action` của React Router)

- `POST /app/search` (intent `save` | `reset` | `preview`) — validate bằng zod, lưu config, xoá cache config trên search-api. Nếu thêm hoặc bớt field có index thì enqueue full sync.
- `POST /app/sorting` (intent `save` | `reorder` | `setDefault`).
- `POST /app/filters`, `/app/merchandising/*`, `/app/appearance`.
- Mọi lần lưu sẽ: ghi Postgres → đẩy thay đổi sang engine (synonym, override) → purge CDN theo tag `shop`.

---

## 10. Lộ trình theo phase

### Phase 0 — Khởi tạo (1–2 ngày)
- [x] 0.1 `shopify app init`, chọn template React Router. Nâng `@shopify/shopify-app-react-router@^4` và `@shopify/polaris-types@^2`; pin `react-router@7`.
  - DoD: `shopify app dev` cài được vào dev store (`--feature-preview new_admin_design`).
- [x] 0.2 Prisma chuyển sang PostgreSQL; `docker-compose` (postgres, redis, typesense).
- [x] 0.3 Lint, Prettier, Vitest, Playwright; CI chạy typecheck, test và `shopify app config validate`.
- [x] 0.4 `shopify.app.toml`:
  - Scopes: `read_products, read_inventory, read_product_listings, read_publications, read_translations, read_locales, read_markets, unauthenticated_read_product_listings, write_app_proxy, write_pixels, read_customer_events`
  - Khai webhook (gồm compliance), `[events]`, `api_version = "2026-10"`.
- [x] 0.5 `docs/adr/` cho D1–D16.

### Phase 1 — Index và Sync (1–2 tuần)
- [x] 1.1 GraphQL executor biết throttle.
- [x] 1.2 `SearchEngine` + `TypesenseEngine` (gồm field động `pos_.*`, `mf_.*`, `price_min_.*`).
- [x] 1.3 Bulk runner: nhiều bulk phẳng song song, chia shard theo `created_at`, stream-parse JSONL, staging, join theo ID (không dựa thứ tự dòng).
  - **Benchmark** trên dev store có 30k và 100k sản phẩm (dùng `productSet` hoặc bulk mutation để tạo dữ liệu mẫu). So 3 cấu hình: lồng một query / phẳng song song / phẳng + shard. Ghi kết quả vào Nhật ký.
  - DoD: **30k sản phẩm (5 variant, 10 metafield) index xong ≤ 5 phút**, mục tiêu 3 phút; 100k ≤ 15 phút; RAM worker ổn định.
- [x] 1.4 Mapper `Product → ProductDoc` (có `gid`, `title_sort`, `discount_pct`, `variant_titles`).
  - DoD: unit test với fixture thật.
- [x] 1.5 Full sync với alias swap, kèm lượt "có kết quả sớm" (1–2k sản phẩm đầu sẵn sàng dưới 60 giây) và tiến độ x/y trên Home.
- [x] 1.6 Webhook routes (HMAC, dedupe, enqueue, < 500ms).
- [x] 1.7 Incremental worker.
- [x] 1.8 Events `collection.products` và `collection.sortOrder`.
  - Test thực tế: smart collection có bắn không. Ghi vào Nhật ký.
  - DoD: đổi tag làm sản phẩm rời smart collection → cập nhật trong vòng 1 phút.
- [x] 1.9 Delta sync theo watermark mỗi 5 phút; chuyển sang delta bulk khi có đột biến; checksum đêm (`id` + `updatedAt`) chỉ lấy lại phần lệch.
  - DoD: import CSV sửa 30k sản phẩm trên gói Standard → index khớp ≤ 10 phút; checksum đêm của 30k sản phẩm không có thay đổi chạy < 2 phút và không ghi gì vào engine.
- [x] 1.10 Uninstall và compliance webhook.
- [x] 1.11 `SyncJob` và trang Sync.
- [x] 1.12 `best_selling_rank`: ưu tiên lấy thứ tự từ Storefront API `products(sortKey: BEST_SELLING)` (phân trang phía server), cập nhật hằng đêm.
  - Gọi từ server bằng storefront access token mà app tạo qua Admin `storefrontAccessTokenCreate` (scope `unauthenticated_read_product_listings`). Không gọi tokenless từ server, vì Shopify giới hạn chặt traffic tự động.
  - Cách này **không cần `read_orders`**. Order là dữ liệu khách hàng được bảo vệ, cần xin Level 1 trở lên.
  - Chỉ chuyển sang đếm từ order nếu cách trên không đủ dữ liệu; khi đó thêm scope và xin quyền Protected Customer Data.
- [x] 1.13 `pos_{collectionId}` cho thứ tự thủ công.
  - Đo dung lượng document với shop 500 collection; nếu vượt ngưỡng thì chuyển sang phương án dự phòng (mục 4.4).
- [x] 1.14 Đồng bộ `Shop.markets` (currency, có giá cố định hay không) qua webhook `markets/*` và mỗi đêm.
- **DoD của phase:** sửa sản phẩm → search đổi sau ≤ 60 giây (p95); không mất cập nhật khi có 1.000 sự kiện dồn dập; re-index không downtime.

### Phase 2 — Search API, Currency, SDK và Storefront (2–3 tuần)
- [x] 2.1 `services/search-api`: `/suggest`, `/search`, `/collection`, `/config`, `/events`; scoped key; rate limit; cache; 503 khi engine lỗi.
  - DoD: 200 RPS, p95 < 120ms.
- [x] 2.2 **Query builder từ `SearchSettings.fields`** (`query_by`, `query_by_weights` map 1–10 → 0–127, `num_typos`, `prefix` theo từng trường).
  - DoD: unit test; đổi trọng số trong DB → thứ hạng đổi ngay mà không re-index.
- [x] 2.3 **Sort builder từ `SortOption` / `SortDefault`** (≤ 3 trường, đẩy hết hàng xuống, tie-break, `manual` theo collection).
  - DoD: test cho từng key trong bảng 4.4.
- [x] 2.4 Bộ dịch filter (`filter.p.*` / `filter.v.*` ↔ `filter_by`), facet count và min/max giá.
- [x] 2.5 Merchandising: synonym, stop word, redirect, override, boost.
- [x] 2.6 **`packages/storefront-sdk`**: client, state đồng bộ URL, event bus, DOM events, template engine tối giản (không `eval`, có escape HTML), `mount`, `formatMoney`.
  - DoD: ≤ 8 KB gzip; có unit test; có type `.d.ts` công khai.
- [x] 2.7 **Pricing (D15):**
  - 2.7a Test tokenless same-origin `/api/2026-10/graphql.json` trên custom domain và trên `.myshopify.com`; chọn endpoint.
  - 2.7b Module `pricing` trong SDK: dựng query `nodes` + `@inContext`, merge theo gid, ẩn node `null`, tính `rate`, quy đổi slider, cache trong session, fallback "Xem giá".
  - 2.7c Kiểm tra complexity thực tế với 48 ID (giữ dưới 1.000 với biên an toàn).
  - **DoD:**
    - Shop dev có 3 market (USD gốc, EUR quy đổi tự động, VND có price list cố định): giá trên kết quả search, collection và autocomplete **khớp 100%** với giá trên trang sản phẩm của theme.
    - **Đúng 1 request Storefront mỗi lần tải trang kết quả.**
    - Sản phẩm không bán ở market bị ẩn.
    - Filter giá hoạt động ở EUR.
- [x] 2.8 Phương án B: `price_min_{CC}` cho market có giá cố định (sau khi xác nhận API ở 6.3).
- [x] 2.9 `packages/storefront-ui` (instant search, results, filters, sort, pagination) xây trên SDK.
  - DoD: instant ≤ 10 KB gzip; đạt axe; không gây CLS.
- [x] 2.10 App embed và 2 app block (Liquid native trước, rồi hydrate); block settings (mục 7.2); hỗ trợ `data-searchapp-mount`.
- [x] 2.11 Fallback khi tắt engine: trang vẫn có sản phẩm, không lỗi console.
- [x] 2.12 Đa ngôn ngữ (`request.locale`), nhãn sort và filter theo locale.
- [x] 2.13 Web pixel và `/events`; rollup `AnalyticsDaily`.
- [x] 2.14 Lighthouse CI (Horizon, 3 loại trang).
  - DoD: giảm ≤ 5 điểm.

- [ ] 2.15 **Best-selling theo order 60 ngày gần nhất (D17)**
  - **Scope:** thêm `read_orders` vào `optional_scopes`, cạnh `read_online_store_pages`. Admin xin quyền bằng `shopify.scopes.request(['read_orders'])` ở trang Sorting và ở bước onboarding "Bật xếp hạng bán chạy theo đơn hàng". Kiểm tra trạng thái bằng `shopify.scopes.query()`. Chưa được cấp quyền thì giữ nguồn Storefront `BEST_SELLING` (1.12) và hiển thị rõ đang dùng nguồn nào.
  - **Protected customer data:** Order thuộc dữ liệu được bảo vệ, cần **Level 1**. App không đọc field nào của customer (không `customer`, `email`, địa chỉ). Ghi bước xin Level 1 trong Partner Dashboard vào HUMAN_TODO. Cập nhật ADR 0013 và privacy policy: dữ liệu order nào được xử lý, mục đích, thời hạn lưu 60 ngày, mã hoá.
  - **Dữ liệu:** bảng Prisma `OrderLine(shopId, orderId, productId, qty, createdAt)`, unique theo (`shopId`, `orderId`, `productId`). **Chỉ lưu ID và số lượng.** Mỗi ngày xoá dòng cũ hơn 60 ngày. Khi nhận `shop/redact` thì xoá hết. `customers/redact` không ảnh hưởng vì không có customer id.
  - **Nạp lần đầu (sau khi được cấp quyền):** bulk `orders(query:"created_at:>='<now−60d>' AND test:false")`, chỉ lấy `id createdAt cancelledAt lineItems { currentQuantity product { id } }`. `currentQuantity` đã trừ hoàn, huỷ và chỉnh sửa. Bỏ order `cancelledAt != null`. Tính `qty` = tổng `currentQuantity` theo product. Validate query bằng `shopify app execute`; cú pháp filter `test:false` có thể khác, cần tra docs.
  - **Cập nhật liên tục:** webhook `orders/create`, `orders/updated`, `orders/cancelled` (khai trong TOML; topic không có quyền thì bỏ qua cho tới khi được cấp quyền). Handler xác thực, enqueue, rồi worker lấy lại line items của order qua GraphQL và upsert `OrderLine`. Đơn huỷ thì qty = 0. `orders/updated` bắn cả khi hoàn tiền hoặc chỉnh sửa đơn.
  - **Tính hạng:** job mỗi 15 phút (debounce khi có order mới) chạy `SUM(qty) GROUP BY productId` trên cửa sổ 60 ngày → hạng 1..n. **Chỉ cập nhật `best_selling_rank` cho sản phẩm đổi hạng** (partial update, không re-index). Sản phẩm không bán được thì để trống `best_selling_rank` (missing last, tie-break `published_at:desc`). Thêm tuỳ chọn tiêu chí: số lượng (mặc định), số đơn, doanh thu. Doanh thu cần thêm `discountedTotalSet.shopMoney`; quy về currency của shop.
  - **Admin:** Sorting → "Nguồn xếp hạng bán chạy": Shopify (mặc định khi chưa cấp quyền) / Đơn hàng 60 ngày. Hiện thời điểm tính cuối và số order đã dùng. Tắt thì gọi `shopify.scopes.revoke(['read_orders'])`, xoá `OrderLine` và quay về nguồn Shopify.
  - **DoD:**
    - Fixture 1.000 order (có đơn huỷ và hoàn một phần) cho đúng hạng.
    - Order mới → hạng cập nhật ≤ 15 phút.
    - Không có field customer nào trong query hay DB (có test grep query).
    - Thu hồi quyền → dữ liệu bị xoá và quay về nguồn Shopify.
    - Unit và integration test pass.

### Phase 3 — Admin App Home (2 tuần)
- [x] 3.1 Layout, `s-app-nav`, Home (checklist qua `app.extensions()` cùng deep link), card sync, KPI.
- [x] 3.2 **Trang Search:** bảng trường (toggle, trọng số, typo, prefix), thêm metafield, các cài đặt chung, **ô Thử tìm xem trước theo cấu hình chưa lưu**, nút khôi phục mặc định.
  - DoD: Save Bar chạy đúng; đổi trọng số rồi bấm Thử tìm thấy thứ hạng đổi; thêm metafield thì hiện cảnh báo và tự enqueue sync.
- [x] 3.3 **Trang Sorting:** toggle, đổi nhãn theo locale, kéo thả thứ tự, sort theo metafield, mặc định cho search và collection, ghi đè theo collection.
  - DoD: storefront hiển thị đúng danh sách, thứ tự và nhãn sau khi lưu (≤ 1 phút, tính cả purge cache).
- [x] 3.4 Filter tree builder.
- [ ] 3.5 Merchandising.
- [ ] 3.6 Appearance có live preview.
- [ ] 3.7 Analytics (thêm sort usage).
- [ ] 3.8 **Trang Developers:** public key, endpoint, snippet mẫu, link docs.
- [ ] 3.9 Plans (managed pricing).
- [ ] 3.10 Kiểm tra mobile, hai giao diện admin, Web Vitals của admin.

### Phase 4 — Tài liệu cho developer (song song Phase 3, khoảng 1 tuần)
- [ ] 4.1 `docs/developers/`: quickstart, tham chiếu SDK (tạo tự động từ `.d.ts`), DOM events, template, OpenAPI cho JSON API, changelog.
- [ ] 4.2 Ba section mẫu (Liquid + JS) chạy được trên Horizon: grid tuỳ biến, filter ngang, sort dropdown riêng.
- [ ] 4.3 Contract test: SDK v1 không đổi chữ ký (snapshot `.d.ts`); CI fail nếu có thay đổi phá vỡ mà không nâng major.

### Phase 5 — AI search (tuỳ chọn, sau MVP)
- [ ] 5.1 Hybrid search (embedding), bật theo gói.
- [ ] 5.2 Hiểu truy vấn: "váy đỏ dưới 500k" → filter.
- [ ] 5.3 Gợi ý synonym từ log zero-result (merchant duyệt).

### Phase 6 — Hardening và Launch (1–2 tuần)
- [ ] 6.1 Observability: độ trễ sync, độ sâu queue, p95 search, tỷ lệ lỗi request giá Storefront.
- [ ] 6.2 Load test (Black Friday ×10); Typesense HA cluster 3 node, backup.
- [ ] 6.3 Bảo mật: `shopify app security check`, HMAC, cách ly tenant, template engine chống XSS.
- [ ] 6.4 Deploy admin, search-api và workers; Postgres và Redis managed.
- [ ] 6.5 Hồ sơ App Store (listing, video, privacy policy, hướng dẫn theme, tài khoản cho reviewer).
- [ ] 6.6 Soát checklist BFS và nộp.

---

## 11. Checklist Built for Shopify (kiểm tra trước khi submit)

- [ ] Có App Bridge mới nhất trong `<head>`; session token / token exchange; chạy được không cần cookie bên thứ ba.
- [ ] Managed install; expiring offline token; OAuth chạy ngay khi cài và cài lại.
- [ ] Chỉ GraphQL Admin API, version 2026-10.
- [ ] Polaris web components 2.x; `s-app-nav`; Save Bar trên mọi form; `s-modal` / `s-app-window`.
- [ ] Home có trạng thái setup, trạng thái embed (`app.extensions()`) và KPI; onboarding đóng được.
- [ ] Live preview cho Appearance.
- [ ] Không có sign-up hay login riêng.
- [ ] Storefront chỉ qua theme app extension; không ScriptTag; không ghi Asset API.
- [ ] Lighthouse giảm ≤ 10 điểm (mục tiêu nội bộ ≤ 5).
- [ ] Admin Web Vitals p75: LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms.
- [ ] 3 compliance webhook; HMAC sai trả 401; `shop/redact` xoá sạch.
- [ ] Billing managed pricing; merchant tự đổi gói.
- [ ] Không có pattern gây áp lực; tính năng ngoài gói disable rõ.
- [ ] Đủ 50 lượt cài net và 5 review.

---

## 12. Quy ước làm việc cho Claude

1. **Đọc doc mới nhất** trước khi code phần liên quan Shopify API (ưu tiên Shopify Dev MCP hoặc AI Toolkit; nếu không có thì dùng shopify.dev). Không đoán tên field: validate bằng `shopify app execute` hoặc GraphiQL (cả Admin lẫn Storefront).
2. **Không dùng:** `@shopify/polaris` React, REST Admin, ScriptTag, ghi Asset API, `ui-nav-menu`, React Router 8, SQLite ở production, `Shopify.currency.rate`.
3. Webhook route không nằm dưới `app.tsx`. Handler chỉ xác thực rồi enqueue; xử lý idempotent.
4. Viết test trước cho logic: mapper, query builder, sort builder, filter translator, pricing merge và quy đổi, template engine, HMAC. Chạy `npm run typecheck && npm test` trước khi tick hoàn thành.
5. Chuỗi UI đưa vào i18n (`en`, `vi`).
6. Đo bundle storefront sau mỗi build; vượt ngân sách thì CI fail.
7. **SDK công khai là hợp đồng:** đổi chữ ký nào cũng phải cập nhật `docs/developers/` và changelog.
8. Đổi quyết định nào thì cập nhật bảng D-x và Nhật ký.
9. Bí mật chỉ lấy từ env.

---

## 13. Câu hỏi còn mở

1. Hạ tầng: tự host Typesense hay Typesense Cloud? Cloud nào (GCP để dùng Pub/Sub)?
2. Ngôn ngữ ưu tiên: tiếng Anh, hay cần tiếng Việt ngay (ảnh hưởng tokenizer và typo)?
3. Bảng giá theo số sản phẩm?
4. Markets: MVP có cần phương án B (price list cố định) không, hay chỉ cần quy đổi tự động?
5. Developer API: có cho dùng headless (ngoài theme) ở gói thấp không, hay chỉ gói cao?

---

## 14. Nhật ký
- 2026-10-26: Tạo kế hoạch dựa trên `01-RESEARCH.md`.
- 2026-10-26: Tối ưu sync: bỏ full re-index hằng đêm, chuyển sang delta + checksum; full sync dùng bulk phẳng song song + shard + metafield alias + có kết quả sớm; incremental gom lô `nodes(ids:)` và dùng payload của Events.
- 2026-10-26: Bỏ phần chat AI ("app chat" là gõ nhầm). Thêm D15 (currency qua Storefront API, 1 request mỗi trang), D16 (Developer SDK/API cho custom section), cấu hình trường search (bật/tắt và trọng số), cấu hình sorting.
- 2026-10-26: 0.1 xong: template React Router clone từ GitHub, nâng @shopify/shopify-app-react-router@4.0.0, polaris-types@2.0.0, pin react-router@7.18.4; Node 22.23.4 qua nvm (.nvmrc). DoD cài vào dev store → HUMAN_TODO A1–A3.
- 2026-10-26: 0.2 xong: Prisma → PostgreSQL với đầy đủ model mục 4.1 (+ AnalyticsUsageDaily cho filter/sort usage); docker-compose chỉ Typesense 30.1, postgres/redis sau profile standalone; dev dùng lại postgres_db/docker-redis-1.
- 2026-10-26: 0.3 xong: Prettier, Vitest 5 (node + happy-dom), Playwright (chromium + Pixel 7, trang fixture tĩnh), CI GitHub Actions (typecheck, lint, format, test, bundle budget, e2e, build; job riêng shopify app config validate cần token → HUMAN_TODO B1).
- 2026-10-26: Chốt câu hỏi mở mục 13 bằng mặc định: (1) Typesense self-host docker cho dev, cấu hình deploy cho cả Typesense Cloud và self-host; (2) UI admin en + vi, search tối ưu tiếng Anh trước, locale cấu hình được (`SEARCH_DEFAULT_LOCALE`); (3) Gói: Free < 100 sản phẩm · $9 (1k) · $19 (5k) · $49 (30k) · $99 (100k) · $199 (300k); (4) Markets: quy đổi tự động trước, phương án B sau feature flag `fixedMarketPrices`; (5) Headless API mở từ gói $49.
- 2026-10-26: 0.5 xong: docs/adr/0001–0016 (D1–D16) + README index.
- 2026-10-26: 1.2 xong: SearchEngine interface + TypesenseEngine (Typesense 30: synonym_sets/curation_sets thay synonyms/overrides theo collection), schema dựng từ config với field động pos_.*, opt_.*, price_min_.* và metafield có kiểu; integration test chạy với Typesense thật (alias swap, curation pin/hide, export).
- 2026-10-26: 1.1 xong: GraphqlExecutor theo leaky bucket (extensions.cost.throttleStatus), chờ trước query đắt, retry THROTTLED/429/5xx có backoff, giới hạn song song; adapter cho admin.graphql (GraphqlQueryError) và fetch trực tiếp. 11 unit test.
- 2026-10-26: 2.2 xong: buildTextQuery (query_by/weights 1–10→0–127/num_typos/prefix theo trường, bản dịch đứng trước, bỏ field chưa index). ĐO THỰC TẾ: text_match_type=max_score chỉ dùng trọng số để tie-break (exact match field ngắn lấn át) → đổi mặc định matchMode sang max_weight (migration). Live test: đổi trọng số → thứ hạng đảo ngay, không re-index.
- 2026-10-26: 2.3 xong: buildSortBy ≤ 3 trường (_eval đẩy hết hàng, sort chính, tie-break), missing_values: last cho pos_/best_selling/price_min_{cc}/mf; resolveSortKey theo SortDefault + sortOrder của collection; test từng key bảng 4.4.
- 2026-10-26: 2.4 xong: filter translator dùng đúng tham số native filter.p.*/filter.v.* (URL dùng chung cho fallback), filter_by có escape, giá đổi minor units theo exponent currency, facet disjunctive + min/max giá.
- 2026-10-26: 0.4 xong: shopify.app.toml theo cú pháp đã đối chiếu (docs/shopify-api/config-extensions.md): 11 scope, webhook gom theo route + include_fields, compliance_topics, [[events.subscription]] collection.products + collection.sortOrder, app proxy /apps/search. Bỏ product_listings/* và collection_listings/* (chỉ áp dụng cho kênh riêng của app, không phải Online Store). Contract test smol-toml; validate thật → HUMAN_TODO C1–C2.
- 2026-10-26: Nâng React 18 → 19.3 (theo docs App Home: controlled field của Polaris web components cần React 19); thêm app/types/app-bridge-jsx.d.ts nối JSX global của app-bridge-types vào React.JSX. Ghi chú tra cứu API ở docs/shopify-api/ (Admin 34 op đã validate 2026-10, Storefront 5 op, config/extension, App Home).
- 2026-10-26: 1.4 xong: mapProduct (gid, title_sort không dấu, discount_pct, variant_titles bỏ Default Title, opt_* theo option, metafield có kiểu, pos_ chỉ cho collection MANUAL, bản dịch, price_min_{cc}); fixture JSONL theo shape query đã validate (fixture thật → HUMAN_TODO D1). Query sync sinh động: 14 op đã pass MCP validate 2026-10.
- 2026-10-26: 1.3 xong: BulkRunner (≤5 bulk song song, LIMIT_REACHED → chờ, poll + notifier webhook, stream-parse JSONL ngay khi từng bulk xong), shard theo created_at (productsCount + oldest/newest đã validate), collections chạy groupObjects:true để giữ thứ tự (Shopify chỉ đảm bảo ở dạng grouped), join theo ID. Staging: RAM (≤ 20k) hoặc Postgres UNLOGGED (lớn hơn, RAM cố định). BENCHMARK tổng hợp (pipeline phía app, chưa gồm thời gian bulk của Shopify; 5 variant, 10 metafield): 30k RAM 4.0s / heap 186MB; 30k PG 7.6s / 138MB; 100k PG 25.8s / 195MB (chạy được với heap 256MB); 100k RAM OOM ở 256MB. Phát hiện client typesense (axios) giữ bộ nhớ khi import lớn → import chuyển sang fetch native (heap 160MB OOM → 42MB). Benchmark trên store thật (3 cấu hình) → HUMAN_TODO D2.
- 2026-10-26: 1.5 xong: runFullSync (collection v(n+1), alias trỏ ngay khi lần đầu, ghi đôi qua marker Redis khi re-index, bulk song song + lượt sớm ≤1.000 sp/45s chạy cùng lúc, kiểm tra lệch ≤ 2%, swap alias + xoá bản cũ, watermark lùi 2 phút, index c_{shopId} cho collection). afterAuth → ensureShop + seed mặc định + xếp full sync. Worker BullMQ + job scheduler (delta/đêm/cleanup/rollup). Home tạm hiện x/y. Int test với Postgres+Typesense thật: lần đầu, swap v2, lệch 2% giữ alias cũ, staging Postgres. Scope tuỳ chọn read_online_store_pages cho pages/articles.
- 2026-10-26: 1.6 xong: tự xác thực HMAC (base64 HMAC-SHA256 raw body, timingSafeEqual) cho cả webhook và Events — không gọi authenticate.webhook để khỏi tra/refresh session mỗi lần; dedupe bằng WebhookReceipt (webhookId unique); map topic → job; app/uninstalled xoá session ngay; 7 route webhook + route Events (/api/events/collections). Int test: 200 < 500ms, dedupe, 401 HMAC sai, bulk signal, redact theo domain. Contract test: mọi uri trong TOML có file route.
- 2026-10-26: 1.7 xong: incremental tách 3 query (core ≤50 ID, variants qua product_ids, collections ≤18 ID) theo ước lượng cost; debounce bằng set chờ + cờ scheduled (một job/shop/cửa sổ 3s, sự kiện đến lúc đang chạy không mất); khoá theo shop; ngân sách 60s/lượt rồi tự lên lịch; lỗi → trả ID về set chờ; > 2.000 ID → delta bulk lồng + lấy lại phần thiếu; giữ pos_*/best_selling_rank/giá market/bản dịch từ doc cũ; ghi đôi khi full sync đang chạy; inventory item → product qua nodes(InventoryItem). Int test: 1.000 sự kiện dồn dập → 1 job, 1.000 doc, không mất; spike 2.100 ID qua bulk.
- 2026-10-26: 1.8 xong: syncCollection lấy thứ tự COLLECTION_DEFAULT phân trang, cập nhật thành viên (vào/ra) và pos_{id} chỉ khi MANUAL (đổi khỏi MANUAL → xoá pos_), collection xoá → gỡ khỏi mọi product + index nội dung; c_{shop} lưu handle (lọc được) + sort_order. Khoá theo shop+collection. Smart collection: Events CHƯA XN → test thực tế ở HUMAN_TODO D5; DoD 'rời smart collection ≤ 1 phút' đã có đường dự phòng chắc chắn: products/update → incremental lấy lại product.collections (int test xác nhận).
- 2026-10-26: 1.9 xong: delta mỗi 5 phút (tick 1 phút chọn shop đến hạn, jobId theo khung 5 phút), products(updated_at > watermark−2') ≤ 8 trang, vượt 2.000 → delta bulk lồng; checksum đêm = bulk {id updatedAt} + bulk collections (grouped) → chỉ sửa ID thiếu/cũ/thừa và collection lệch (chỉ so collection đã publish để tránh ghi thừa), lệch > 2% → full sync. Benchmark: checksum 30k không đổi 0,9 s phía app, 0 lần ghi engine (spy). Đo thật trên store → HUMAN_TODO D6.
- 2026-10-26: 1.10 xong: app/uninstalled → session xoá ngay (webhook), job huỷ việc chờ + giữ index 48h; shop/redact → xoá collection/alias/synonym/curation/stopword trong engine, cascade toàn bộ bảng của shop, key Redis, session, receipt (idempotent khi Shopify gửi lại); customers/* chỉ log (không lưu dữ liệu khách). Dọn định kỳ: receipt > 7 ngày, shop gỡ > 7 ngày chưa nhận redact. Int test xác nhận xoá sạch.
- 2026-10-26: 1.11 xong: SyncJob ghi stats (bulks, imported, lỗi) + trang Sync (trạng thái + tiến độ s-progress, lịch sử 20 job, Sync now qua fetcher, banner lỗi kèm cách sửa). i18n en/vi (app/i18n, test đủ key). Mẫu: UI tách thành component thuần (app/components/*View.tsx) để validate Polaris App Home v2.0 bằng MCP (SyncView: VALID) và test SSR.
- 2026-10-26: 1.12 xong: best_selling_rank từ Storefront products(sortKey: BEST_SELLING) phân trang 250, nghỉ 250ms/trang, backoff 430/429. ĐỔI so với plan: dùng private token qua unauthenticated.storefront (offline Admin token làm Shopify-Storefront-Private-Token, scope unauthenticated_read_product_listings) thay cho storefrontAccessTokenCreate — docs xác nhận token tạo bằng mutation đó là PUBLIC và traffic tự động bằng token public bị giới hạn. Không cần read_orders. Chỉ ghi doc có rank đổi (đêm bình thường 0 lần ghi); rank giữ qua re-index; chạy ngay sau full sync đầu. Kiểm chứng thật → HUMAN_TODO D7.
- 2026-10-26: 1.13 xong: pos_{collectionId} chỉ lưu cho collection MANUAL (sort khác map sang key có sẵn). ĐO (scripts/bench-pos.ts, Typesense 30.1, 20k sp, 500 collection MANUAL): mỗi sp thuộc 20 → +4 MB RAM, doc +300 B, sort p95 15 ms (không pos: 12 ms); trường hợp xấu nhất mỗi sp thuộc cả 500 → +750 MB (~75 B/vị trí), doc 24 KB, p95 40 ms. Dự phòng: ngân sách 1M vị trí/shop, vượt → mỗi collection chỉ lưu pos_ cho 250 vị trí đầu (phần merchant tự sắp), đuôi rơi về tie-break bán chạy; posCap lưu ở Shop.features, áp dụng ở full sync + syncCollection.
- 2026-10-26: 1.14 xong: Shop.markets từ markets(catalogs{priceList{currency fixedPricesCount parent.adjustment}}) — Market.priceList deprecated; chỉ market REGION ACTIVE; hasFixedPrices = fixedPricesCount > 0. Chạy qua webhook markets/* + lượt đêm (không có webhook cho price list). shop-refresh cũng cập nhật currency/locales; full sync khi đổi currency gốc, thêm locale, hoặc đổi tập country giá cố định khi bật fixedMarketPrices. So sánh JSON dạng chuẩn hoá (jsonb sắp lại key).
- 2026-10-26: Kết thúc Phase 1: test đầu-cuối webhook → searchable 3,2 s, burst 1.000 sự kiện 3,5 s, không mất cập nhật. Tổng kết ở docs/PROGRESS.md.
- 2026-10-26: 2.1 xong: services/search-api (Hono) /v1/suggest, /search, /collection, /config, /events + /internal/purge; pipeline 8 bước dùng chung ở app/lib/search-service (admin 'Thử tìm' dùng lại); scoped key theo shop (Typesense keys collections [p_{id}, p_{id}_v.*, c_{id}, c_{id}_v.*] — đã đo: so khớp nguyên tên, không lẫn shop có id là tiền tố); rate limit IP + shop theo gói (Redis, fallback bộ nhớ); CORS theo domain shop (primary + web presence), origin lạ = headless → chỉ gói ≥ $49; Cache-Control 30s/swr 300 + Cache-Tag/Surrogate-Key shop-{domain}; micro-cache 10s; 503 khi engine lỗi. App proxy /apps/search/v1/* (same-origin, xác thực chữ ký hex). PHÁT HIỆN: Typesense 30 dùng curation_tags (override_tags bị bỏ qua); facet/filter/sort trên field động chưa tồn tại báo lỗi → kiểm tra trước, filter bất khả → 0 kết quả. LOAD TEST (30k sp, local): 204 RPS, 0 lỗi, p97.5 67 ms, p99 78 ms (nhiều cache miss: p99 60 ms).
- 2026-10-26: 2.5 xong: synonym (đa chiều + một chiều), stop word theo locale (tham số stopwords), redirect (tra trước search), curation set: ghim/ẩn theo query (exact/contains), rule theo collection qua curation_tags col_{id}, boost/bury bằng sort_by _eval([(field:=v):w]) trong curation, lịch hiệu lực effective_from/to. Lưu ở admin → afterConfigSaved: đẩy merch sang engine + purge Redis/micro-cache/CDN tag. Int test qua pipeline thật (5 ca).
- 2026-10-26: 2.6 xong: packages/storefront-sdk (window.SearchApp v1): client (timeout 3s, gộp request trùng, cache phiên), state đồng bộ URL bằng đúng tham số native (q, filter.p.*/filter.v.*, sort_by, page), event bus + DOM events searchapp:* (before-search sửa được params / huỷ), template engine không eval + escape + chặn javascript:, mount/registerWidget + data-searchapp-mount, formatMoney theo moneyFormat của theme, track() gom beacon. Bundle 4,96 KB gzip (ngân sách 8 KB). .d.ts công khai: packages/storefront-sdk/dist (tsc). 18 test (happy-dom).
- 2026-10-26: 2.7 xong (2.7b đầy đủ; 2.7a/2.7c cần store thật → HUMAN_TODO F1–F3): pricing trong SDK — 1 request nodes(ids)+@inContext(country, language) cho cả trang (test: 48 ID → đúng 1 fetch, không lấy variants), map theo id, node null → ẩn sản phẩm, rate = median giáLocal/giáGốc theo đơn vị chính (đúng cả VND exponent 0), quy đổi khoảng giá filter, cache phiên gid+country, timeout 1,5s/lỗi GraphQL → priceReady=false → 'Xem giá'. Endpoint mặc định https://{shop}.myshopify.com/api/2026-10/graphql.json (có tài liệu), same-origin cấu hình được. Query rút gọn đã validate Storefront 2026-10. SDK 5,97 KB gzip.
- 2026-10-26: 2.8 xong: phương án B sau flag fixedMarketPrices — alias cp_{CC}: contextualPricing(context:{country}) gắn vào query variants (bulk phẳng, bulk lồng delta, incremental; tối đa 10 country) → price_min_{cc} = min giá cuối của variant theo currency market; search-api dùng price_min_{cc} cho filter/sort khi field có trong index; SDK không quy đổi khi country có giá cố định. Schema hợp lệ 2026-10; dùng trong bulk CHƯA XN → HUMAN_TODO F4. Sửa kèm lỗi 1.13: manualSizes chưa được truyền vào buildFullSyncSpecs (ngân sách pos_ không tính) + thêm assertion trong test full sync.
- 2026-10-26: 2.9 xong: packages/storefront-ui — instant search (ARIA combobox, phím ↑↓/Enter/Esc, dropdown position:fixed không CLS, nhóm gợi ý/sản phẩm/collection, 'Xem tất cả', API lỗi → submit native) 2,23 KB gzip; widget search-page (filter trái/trên/drawer, checkbox/radio/swatch/toggle/khoảng giá, chip bỏ chọn + xoá tất cả, sort, phân trang có href SEO, popstate, aria-live số kết quả, giữ min-height khi thay nội dung) 3,44 KB gzip; CSS biến hoá được; template ghi đè. Playwright (Chromium + Pixel 7) trên trang fixture: axe không vi phạm serious/critical, CLS < 0.1, đúng 1 request Storefront/lần tải khi khách dùng EUR, ẩn sản phẩm không bán ở market, engine lỗi → giữ grid native, không lỗi JS. JS lần đầu 8,2 KB gzip.
- 2026-10-26: 2.10 xong: extensions/search-theme — app embed (target body: sa-config JSON context theo localization/cart.currency/money_format, SDK defer, instant nạp lười khi focus ô search, results nạp khi có data-searchapp-mount, chọn app proxy hoặc search-api trực tiếp), block search-results + collection-filter (target content theo docs mới; Liquid in grid native + phân trang native trước, rồi hydrate; setting cột, số sp/trang, vị trí filter trái/trên/drawer, bật sort, sort mặc định). App-data metafield searchapp.public_key/api_url ghi lúc cài (metafieldsSet đã validate). Theme Check (MCP validate_theme): 7/7 file PASS. Contract test: target, asset tồn tại, Liquid < 100 KB, script defer/async, locale en/vi.
- 2026-10-26: 2.11 xong: Liquid in grid native trước (block) → engine/API lỗi (503, mạng hỏng, timeout 3 s) thì giữ nguyên kết quả native, widget nuốt lỗi (không lỗi JS); instant lỗi → Enter submit /search native; Storefront API lỗi → 'Xem giá', không bao giờ hiện sai currency. E2E Playwright 4 ca fallback × 2 thiết bị pass (lỗi 'Failed to load resource' do trình duyệt tự in khi API trả 503 được loại khỏi kiểm tra).
- 2026-10-26: 2.12 xong: locale khách (request.locale) → SDK → API: nhãn sort/filter theo locale (labelFor, fallback ngôn ngữ gốc → en), text widget mặc định en/vi + ghi đè từ Appearance, query_by thêm title_{l}/description_{l} trước field gốc. Sync bản dịch: alias tr_{locale}: translations(locale:) { key value } trong bulk products, nodes(ids) incremental và delta bulk (field, không phải connection); key title/body_html → title_{l}/description_{l}. Thêm locale → full sync (1.14). Query đã validate 2026-10; chạy thật trong bulk → HUMAN_TODO H1.
- 2026-10-26: 2.13 xong: web pixel extensions/search-pixel (runtime strict, customer_privacy analytics only, settings shop/apiUrl/publicKey) — chỉ ghi add_to_cart/purchase sau lượt search trong 30 phút của phiên (không đếm search để tránh trùng với search-api), doanh thu quy về currency gốc bằng rate SDK lưu ở sessionStorage; fetch keepalive (sendBeacon đã deprecated). Kích hoạt bằng webPixelCreate/Update lúc cài (đã validate). /v1/events nhận beacon (miễn kiểm tra headless). Rollup Redis → AnalyticsDaily/AnalyticsUsageDaily mỗi 10 phút, ghi đè (idempotent), chốt ngày đã qua. Ẩn danh (D13).
- 2026-10-26: Thêm D17 và task 2.15: best-selling theo order 60 ngày (`read_orders` optional scope, PCD Level 1, chỉ lưu ID và số lượng); Storefront BEST_SELLING làm fallback.
- 2026-10-26: 2.14 xong (đo trên theme fixture; Horizon thật → HUMAN_TODO G3): scripts/lighthouse-compare.mjs (Lighthouse 13 mobile, gzip như CDN, theme có JS/CSS ở cả 2 bản, median 3 lần, trọng số BFS) + lighthouserc.json + bước CI. Tối ưu sau khi đo: app embed không còn CSS chặn render; trang không phải search/collection không tải gì lúc đầu (SDK + instant nạp khi focus ô search, stub window.SearchApp.ready() giữ hợp đồng v1); /config tải lười; block in sẵn khung layout (toolbar + cột filter giữ chỗ) và widget giữ nguyên grid native khi API trả đúng sản phẩm/thứ tự (không vẽ lại ảnh). KẾT QUẢ: Home 0, Product 0, Collection −1 (TBT +81 ms, JS 11,3 KB gzip) → giảm có trọng số 0,4 điểm (ngưỡng 5). Trước tối ưu: LCP Home/Product +750 ms (mô phỏng).
- 2026-10-26: Kết thúc Phase 2 — tổng kết ở docs/PROGRESS.md.
- 2026-10-26: 3.1 xong: layout app.tsx (AppProvider + s-app-nav i18n, link home rel=home; gửi Web Vitals admin → /app/vitals → Redis, p75 28 ngày); Home: checklist 7 bước (embed/block qua shopify.app.extensions() + deep link theme editor, search/sort/filter/preview) có tiến độ, đóng được, nút chính = bước kế tiếp; banner lỗi sync; KPI 7 ngày + xu hướng; card sync. HomeView validate Polaris App Home v2.0 VALID; test SSR. Shop.onboarding (migration).
- 2026-10-26: 3.2 xong: trang Search — bảng trường (s-switch bật/tắt, s-number-field trọng số 1–10, typo, prefix), thêm/xoá metafield từ definitions (cache Redis 10 phút) kèm cảnh báo re-index và tự xếp full sync khi lưu, xếp hạng (max_weight/max_score/sum_score, tie-break, ưu tiên khớp chính xác), typo, hết hàng, kiểu tìm (xin optional scope read_online_store_pages bằng shopify.scopes.request khi bật page/article), loại trừ tag; 'Thử tìm' ở cột phụ chạy pipeline thật với cấu hình CHƯA lưu + giải thích field khớp (highlight/text_match_info); khôi phục mặc định; Save Bar ui-save-bar (React-controlled); lỗi zod inline theo path. Int test: đổi trọng số chưa lưu → thứ hạng đảo; thêm metafield → reindex. SearchView VALID Polaris v2.0.
- 2026-10-26: 3.3 xong: trang Sorting — bật/tắt, nhãn theo locale (en + locale shop, tối đa 4), kéo thả thứ tự (HTML5 drag + nút lên/xuống cho bàn phím), sort theo metafield số/đánh giá/ngày (asc/desc, tự xếp re-index), mặc định cho search và collection (hoặc theo sortOrder Shopify), ghi đè theo collection qua shopify.resourcePicker, tie-break; best selling bị disable + giải thích khi index chưa có best_selling_rank. Lưu trong transaction + purge. Int test DoD: sau khi lưu, /v1/config của search-api trả đúng thứ tự/nhãn/mặc định ngay (đường purge Redis + /internal/purge). SortingView VALID Polaris v2.0.
- 2026-10-26: 3.4 xong: trang Filters — chọn phạm vi (mặc định / trang search kế thừa hoặc tuỳ chỉnh / ghi đè từng collection qua resourcePicker), mỗi filter: nhãn theo locale, nguồn (vendor, loại, tag + tiền tố, collection, giá, tình trạng, giảm giá, option theo tên, metafield), kiểu hiển thị hợp lệ theo nguồn, thu gọn, hiện số đếm, số giá trị, sắp xếp giá trị, khớp tất cả; sắp thứ tự, thêm/xoá. Lưu một lần mọi FilterSet (transaction), filter metafield mới → re-index; lỗi zod inline (banner liệt kê path). FiltersView VALID Polaris v2.0; int + SSR test.
