# FINAL REPORT — Shopify Search & Filter app

Ngày: 2026-10-26 · Phạm vi: `docs/02-PLAN.md` Phase 0 → 6 (gồm Phase 5 AI tuỳ chọn và task 2.15) · hơn 60 commit `phase<X>.<Y>`.

**Tình trạng:** mọi task Phase 0–6 đã `[x]`. Mục duy nhất còn mở trong plan là "50 lượt cài net và 5 review" (chỉ có sau khi lên App Store). Phần cần tài khoản, store thật, hạ tầng và secret nằm ở `docs/HUMAN_TODO.md` (57 mục), mỗi phần đã có mock/test thay thế.

---

## 1. Đã làm gì

| Phase | Nội dung chính |
|---|---|
| 0 | Template React Router 7 + `@shopify/shopify-app-react-router` 4, Polaris web components 2.x, React 19, Prisma/PostgreSQL, Redis/BullMQ, Typesense 30.1 (docker), Vitest/Playwright/CI, `shopify.app.toml`, ADR D1–D17 |
| 1 | Sync 4 lớp: full sync bằng bulk phẳng song song + shard + lượt "có kết quả sớm" + alias swap; incremental (webhook/Events → debounce → `nodes(ids)` theo lô); delta 5 phút theo watermark; checksum đêm. Uninstall + 3 compliance webhook |
| 2 | search-api (Hono) + app proxy; pipeline 8 bước (redirect, trọng số theo field, stop word, synonym, merch, hết hàng, sort, facet); SDK công khai `window.SearchApp` v1; widget instant + trang kết quả; giá theo market qua Storefront API (1 request/trang); theme app extension (embed nạp lười + 2 block in sẵn kết quả native); web pixel ẩn danh; Lighthouse; **2.15** bán chạy theo đơn 60 ngày (optional `read_orders`) |
| 3 | 11 trang admin (Home, Search, Sorting, Filters, Merchandising, Appearance có live preview, Analytics, Sync, Developers, Plans, Help), en + vi, Save Bar, kiểm tra mobile và Web Vitals |
| 4 | `docs/developers` (quickstart, SDK reference sinh từ `.d.ts`, events, templates, OpenAPI, changelog), 3 section mẫu có E2E, contract test SDK v1 |
| 5 | AI search hybrid (embedding, gói Pro+), hiểu truy vấn ("váy đỏ dưới 500k" → filter, SDK 1.1.0), gợi ý synonym từ truy vấn 0 kết quả |
| 6 | Metrics Prometheus + alert, load test ×10 + HA 3 node + snapshot, bảo mật (security check 35/35), image Docker + Render blueprint + compose, hồ sơ App Store, soát BFS |

## 2. Kiến trúc thực tế

```
                 Shopify Admin (iframe)                         Storefront (theme)
                        │ session token                       │ app embed (stub + SDK lười) · 2 app block · web pixel
                        ▼                                     ▼
 ┌──────────────── admin (React Router 7) ─────────────┐   /apps/search/* (app proxy, ký HMAC)
 │ 11 trang Polaris · webhooks · Events API · /proxy/* ├───────┘          headless / CDN
 │ action → Postgres → purge (Redis, search-api, CDN)  │                         │
 └──────┬──────────────────────────────┬───────────────┘                         ▼
        │ enqueue                      │                          ┌──── search-api (Hono) ────┐
        ▼                              │                          │ auth shop+public key      │
 ┌──── worker (BullMQ) ───────┐        │                          │ rate limit theo IP + gói  │
 │ full/incremental/delta/    │        │                          │ micro-cache · Cache-Tag   │
 │ checksum/content/orders/   │        │                          │ scoped key Typesense/shop │
 │ best-selling/rollup/plans/ │        │                          └────────────┬──────────────┘
 │ snapshot · /metrics        │        │                                       │
 └──┬─────────┬───────────────┘        │                                       │
    │ GraphQL │ bulk                   ▼                                       ▼
    ▼         ▼                 PostgreSQL (cấu hình, merch, analytics,   Typesense 30.1
 Shopify Admin API 2026-10      OrderLine, session)                      (alias theo shop,
 Partner API (App Pricing)      Redis (queue, cache, bộ đếm)              HA 3 node, embedding)
```

- **Một image Docker, 3 process:** admin, search-api, worker.
- **Tách tầng đọc storefront:** search-api tách khỏi admin (D9); storefront đi qua app proxy (cùng origin), headless gọi thẳng search-api.
- **Giá hiển thị** lấy từ Storefront API theo market của khách (D15). Index chỉ lưu giá gốc, dùng để lọc và sắp xếp.
- **Thứ tự dự phòng:** engine lỗi → 503 → widget giữ nguyên kết quả native do Liquid in sẵn. Shop không bao giờ thấy trang trống.

## 3. Kết quả kiểm thử và đo lường

### Test (cổng `typecheck → lint → build storefront + ngân sách → SDK docs → Theme Check → vitest → Playwright`)

| Loại | Kết quả |
|---|---|
| Unit + integration (Vitest; Postgres, Redis, Typesense, model embedding thật) | **352 pass** |
| E2E (Playwright, Desktop Chrome + Pixel 7) | **84 pass**. Phủ: storefront, giá market, fallback, axe, 3 section mẫu, hiểu truy vấn, XSS dữ liệu độc, bố cục + vitals của 24 trang admin |
| Shopify Theme Check | Extension và 3 section mẫu: 0 lỗi |
| `shopify app security check` | **35/35 agent check pass**, 0 finding; 1 nhóm deterministic đã chấp nhận có lý do (xem mục 5) |
| Polaris validator (Shopify Dev MCP, polaris-app-home v2.0) | 11/11 component view VALID |
| GraphQL | Mọi operation Admin/Storefront/Partner đã validate với schema 2026-10 (`docs/shopify-api/`) |
| Contract SDK | Snapshot v1: phá vỡ trong cùng major → CI fail (đã chứng minh) |

### Bundle storefront (ngân sách CI)

| File | gzip | Ngân sách |
|---|---|---|
| `searchapp-sdk.js` | 6,35 KB | 8 KB |
| `searchapp-instant.js` | 2,16 KB | 10 KB |
| `searchapp-results.js` | 4,27 KB | 10 KB gzip (app embed nạp; không khai trong schema block nên không thuộc giới hạn 10 000 B thô của Theme Check) |
| JS tải lần đầu (SDK + instant) | **8,51 KB** | 20 KB |

- **Lighthouse** (fixture theme, mobile, trung vị 3 lần, trọng số BFS): giảm **0,4 điểm** (BFS cho phép 10, mục tiêu nội bộ 5).
- **Web Vitals admin** (24 trang fixture × desktop/mobile): CLS p75 0,000, LCP p75 ≤ 372 ms, không tràn ngang.

### Benchmark sync (phía app; thời gian Shopify chạy bulk chưa tính, xem HUMAN_TODO D)

| Kịch bản | Kết quả |
|---|---|
| Full sync 30k sản phẩm | 4,0 s (staging RAM) / 7,6 s (staging Postgres) |
| Full sync 100k sản phẩm | 25,8 s, heap ≤ 256 MB |
| Checksum đêm 30k, không đổi | 0,9 s, 0 lần ghi |
| Sửa sản phẩm → tìm được (webhook → queue → index) | **3,2 s** (debounce 3 s) |
| 1.000 sự kiện dồn dập, có trùng | Không mất, index xong trong 3,5 s |
| AI search: embed khi import | ~500 sản phẩm/s (2.000 sp / 4 s); query hybrid 3–5 ms |

### Tải và HA

| Kịch bản | Kết quả |
|---|---|
| 200 RPS, 1 process (DoD 2.1) | p99 78 ms |
| **Black Friday ×10: 2.000 RPS tới origin, không CDN, 8 process, 1 laptop** | Đạt 2.000 RPS, **0 lỗi**, p50 15 ms, p99 483 ms (đuôi do CPU Typesense, đối chứng `/config` p99 76 ms) |
| Typesense 3 node: tắt leader giữa tải | **2.459 search, 0 lỗi**; vẫn ghi được; node bật lại bắt kịp dữ liệu |
| Snapshot Typesense | Chạy thật (`TYPESENSE_SNAPSHOT_DIR`) |

Sizing production ở `docs/ops/load-and-ha.md`. Load test đã phát hiện và sửa 2 lỗi thật: cạn pool Postgres khi cache nguội (sửa bằng single-flight + pool 5/process) và thiếu hệ số rate limit mùa cao điểm.

## 4. HUMAN_TODO theo thứ tự cần làm

Chi tiết lệnh và bước nằm ở `docs/HUMAN_TODO.md`.

**Giai đoạn 1: chạy được trên dev store (1–2 ngày)**
1. **A1–A3:** đăng nhập CLI, tạo app + `shopify app config link`, tạo dev store và `shopify app dev`.
2. **B1:** repo GitHub + `SHOPIFY_CLI_PARTNERS_TOKEN` cho CI.
3. **C1–C5:** `shopify app config validate`, `deploy --no-release`, URL thật, tham số `locale`, deep link embed.

**Giai đoạn 2: kiểm chứng trên store thật (các phần đã có mock/test)**

4. **D1–D7:** sync với dữ liệu thật (fixture JSONL thật, benchmark bulk, Events smart collection, 30k sản phẩm, best-selling).
5. **F1–F4:** giá theo market (Markets, price list cố định, `contextualPricing` trong bulk).
6. **G1–G4:** theme Horizon (embed, 2 block, Lighthouse thật, 3 section mẫu).
7. **H1–H2:** bản dịch, web pixel.
8. **I1–I5:** admin ở cả 2 giao diện, mobile, Save Bar, Appearance, Analytics, Developers.
9. **K1–K3:** model embedding trên Typesense (tải sẵn nếu máy không ra internet), AI search trên dev store.
10. **P1–P3:** Protected Customer Data **Level 1** cho `read_orders`, thử bán chạy theo đơn.

**Giai đoạn 3: production**

11. **M1–M4:** chọn nền tảng (Render blueprint hoặc self-host), Postgres + Redis managed (`noeviction`), Typesense Cloud HA, DNS + CDN, secret thật.
12. **E1–E2:** key search-only, CDN purge theo tag.
13. **J1–J3:** Shopify App Pricing (6 gói, handle trùng PlanId), Partner API client, xác nhận URL trang chọn gói.
14. **L1–L4:** Prometheus/Alertmanager, chuẩn bị Black Friday, backup + diễn tập khôi phục, chạy lại security check.

**Giai đoạn 4: App Store và Built for Shopify**

15. **N1–N4:** privacy policy (công ty, email, nhà cung cấp), store demo, video/ảnh trên admin thật, listing tiếng Việt nếu cần.
16. **O1–O3:** chạy lại hướng dẫn review trên store demo, soát `docs/ops/bfs-checklist.md`, nộp review; đủ 50 lượt cài + 5 review → đăng ký BFS.

## 5. Rủi ro còn lại

| Rủi ro | Mức | Giảm thiểu / việc cần làm |
|---|---|---|
| Nhiều điểm chỉ kiểm chứng bằng mock/fixture (bulk thật, Events, market pricing, theme Horizon, App Pricing) | Cao cho ngày đầu chạy thật | HUMAN_TODO D/F/G/J. Mọi query đã validate schema; test tích hợp dùng engine thật |
| Đuôi độ trễ khi tải cao do CPU Typesense | Trung bình | CDN (≥ 50% hit) + 3 node × 8 vCPU cho Black Friday; alert p95 > 150 ms |
| `UNSAFE_INNERHTML` (scanner deterministic) | Thấp | Thiết kế có chủ đích (giới hạn 10 KB). Mọi giá trị đều escape, template merchant được allowlist và sanitize, có E2E dữ liệu độc. Giải trình trong hồ sơ review (`docs/ops/security.md`) |
| Gate headless dựa trên header `Origin` (giả mạo được từ server) | Thấp | Chỉ vượt giới hạn gói, không lộ dữ liệu: dữ liệu công khai, vẫn cần public key, vẫn bị rate limit |
| Ngưỡng ngữ nghĩa của AI search (distance) đo trên tiêu đề ngắn | Trung bình | Merchant chỉnh độ chặt; tinh chỉnh trên catalog thật (K3) |
| Webhook đơn hàng đăng ký theo shop (không qua TOML) | Thấp | Đã validate mutation; kiểm chứng P2. Nightly vẫn tính lại hạng |
| Phụ thuộc `deepmerge-ts` bị override lên 8.x cho Prisma CLI | Thấp | Đã chạy generate/migrate/db push; Dependabot theo dõi |

### Ghi chú `// VERIFY:` trong code (11 chỗ)

| Vị trí | Cần xác nhận | HUMAN_TODO |
|---|---|---|
| `app/lib/config/sort-options.ts:112` | Giá trị enum `CollectionSortOrder` 2026-10 | D |
| `app/lib/shop/markets.server.ts:86` | Enum `PriceListAdjustmentType` | F |
| `app/lib/admin/theme-links.ts:3` | `activateAppId` nhận `{api_key}/{handle}` hay `{uuid}/{handle}` | C5 |
| `app/lib/shopify/graphql.ts:5` | Cấu trúc `extensions.cost` + mã `THROTTLED` | D2 |
| `app/lib/sync/queries.ts:43` | Alias `translations(locale:)` chạy được trong bulk | H1 |
| `app/lib/sync/queries.ts:72` | `ProductVariant.barcode` deprecated (connection mới không dùng được trong bulk) | D1 |
| `app/lib/sync/queries.ts:87` | `contextualPricing` trong bulk | F4 |
| `app/lib/billing/subscription.server.ts:56` | Endpoint Partner API `…/{org}/api/2026-10/graphql.json` | J2 |
| `app/lib/billing/subscription.server.ts:88` | URL trang chọn gói `admin.shopify.com/store/{store}/charges/{handle}/pricing_plans` | J3 |
| `app/i18n/index.ts:14` | Admin truyền `locale` vào query | C4 |
| `deploy/render/render.yaml:2` | Tên field Render Blueprint (`keyvalue`, `maxmemoryPolicy`) | M1 |

Ngoài ra còn 2 điểm nêu trong HUMAN_TODO: cú pháp lọc `created_at:>='…'` cho đơn hàng và scope `read_orders` đủ cho mọi đơn thường (P2–P3).

## 6. Tài liệu chính

- `docs/PROGRESS.md`: tổng kết từng phase, các quyết định tự đưa ra.
- `docs/02-PLAN.md`: checkbox và Nhật ký từng task.
- `docs/ops/`: `observability.md`, `load-and-ha.md`, `security.md`, `deploy.md`, `bfs-checklist.md`.
- `docs/developers/`: tài liệu cho theme developer, OpenAPI, ví dụ.
- `docs/app-store/`: listing, ảnh chụp, privacy policy, hướng dẫn review.
- `docs/merchants/getting-started.md`: hướng dẫn cho merchant.
- `docs/adr/`: ADR 0001–0017.
