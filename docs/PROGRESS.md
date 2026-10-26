# PROGRESS — Shopify Search & Filter app

> Đọc file này đầu tiên khi tiếp tục phiên. Nguồn sự thật: `docs/02-PLAN.md` (checkbox + Nhật ký).
> Tiếp tục: `cat docs/PROGRESS.md && git log --oneline -20 && grep -n "\[ \]\|\[~\]" docs/02-PLAN.md | head`

## Hiện tại
- **HOÀN THÀNH** Phase 0–6 (kể cả 2.15 và Phase 5). Báo cáo: `docs/FINAL_REPORT.md`.
- Còn mở: "50 lượt cài net + 5 review" (sau khi lên App Store) và việc của người trong `docs/HUMAN_TODO.md`.

## Đã xong
- Phase 0: 0.1–0.5 (template RR7 + shopify-app-react-router v4 + polaris-types v2, React 19, Postgres/Prisma, Typesense docker, Vitest/Playwright/CI, shopify.app.toml, ADR D1–D16).
- Phase 1: 1.1–1.14 xong (xem tổng kết bên dưới).
- Phase 2: 2.1 search-api (load test 204 RPS, p99 78 ms), 2.2–2.4 builders, 2.5 merch, 2.6 SDK (5,97 KB gzip), 2.7 pricing Storefront API, 2.8 phương án B.
- Phase 3: 3.1–3.10 xong (xem tổng kết bên dưới).
- Phase 4: 4.1–4.3 xong. Phase 5: 5.1–5.3 xong (xem tổng kết bên dưới).
- Mẫu làm việc: dùng `scratchpad/check.sh` (prettier+typecheck+lint+test) trước mọi commit; `scratchpad/rep.py` để sửa file (báo lỗi nếu không tìm thấy chuỗi).


## Bị chặn / `[~]`
- (chưa có) — các phần cần Shopify thật nằm trong docs/HUMAN_TODO.md (A–D).

## Quyết định tự đưa ra (chi tiết trong Nhật ký 02-PLAN.md)
- Dev dùng lại Docker sẵn có: Postgres `postgres_db` (DB `search_app`, `search_app_test`), Redis `docker-redis-1` (DB 5, test DB 6, prefix `sa:`). Compose dự án chỉ chạy Typesense 30.1.
- Node 22.23.4 qua nvm (`.nvmrc`); lệnh: `export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH`.
- React 19 (Polaris web components controlled fields cần React 19). `app/types/app-bridge-jsx.d.ts` nối JSX.
- Typesense 30: synonym_sets / curation_sets (không còn synonyms/overrides theo collection).
- matchMode mặc định `max_weight` (đo: max_score chỉ dùng trọng số để tie-break).
- Incremental tách query: core ≤ 50 ID (~750 điểm), variants qua productVariants(query: product_ids), collections ≤ 18 ID/request.
- Bulk collections chạy `groupObjects: true` để giữ thứ tự (pos_*). Products/variants phẳng `groupObjects: false`.
- Staging: RAM ≤ 20k sản phẩm, Postgres UNLOGGED khi lớn hơn. Import Typesense bằng fetch native (client typesense rò bộ nhớ).
- Online Store visibility: `onlineStoreUrl != null` (publishedOnCurrentPublication đã deprecated).
- Bỏ webhook product_listings/collection_listings (chỉ cho kênh riêng của app).
- URL filter dùng đúng tham số native `filter.p.*`/`filter.v.*` → fallback native dùng chung URL.
- Tra cứu Shopify: `docs/shopify-api/*.md` + operation đã validate trong `docs/shopify-api/admin|storefront/*.graphql`.
  Client MCP nhỏ ở scratchpad (`@shopify/dev-mcp`, tool `validate`); conversationId 213cbac3-3f5a-42e9-a142-1d5ebad96e39.

## Môi trường
- node v22.23.4 · npm 10.9.9 · Shopify CLI 4.9.4 (chưa đăng nhập) · Docker 24.0.7 · git 2.50.1

## Tổng kết Phase 1 (2026-10-26)
- Sync đủ 4 lớp: full sync (bulk phẳng song song + shard + lượt sớm + alias swap), incremental (webhook/Events → debounce → nodes(ids) theo lô, đột biến → delta bulk), delta 5 phút theo watermark, checksum đêm (chỉ sửa phần lệch). Không full re-index hằng đêm.
- DoD phase (bằng test tích hợp với Postgres/Redis/Typesense thật + Shopify giả lập):
  - Sửa sản phẩm → search đổi: 3,2 s (webhook → BullMQ → worker → Typesense; debounce 3 s) ≪ 60 s.
  - 1.000 sự kiện dồn dập (có trùng lặp): không mất, index đủ trong 3,5 s.
  - Re-index không downtime: alias swap, collection cũ xoá sau swap; lệch > 2% giữ alias cũ.
- Benchmark phía app (chưa gồm thời gian Shopify chạy bulk): 30k sp 4,0 s (RAM) / 7,6 s (PG); 100k 25,8 s heap ≤ 256 MB; checksum 30k 0,9 s, 0 lần ghi.
- BFS liên quan: chỉ GraphQL 2026-10; 3 compliance webhook, HMAC sai → 401; shop/redact xoá sạch (engine + DB + Redis).
- Việc cần store thật: HUMAN_TODO D1–D7 (fixture thật, benchmark bulk, Events smart collection, CSV 30k, best-selling).

## Tổng kết Phase 2 (2026-10-26)
- search-api (Hono) + app proxy: pipeline 8 bước dùng chung; scoped key/shop; rate limit; CORS; cache; 503 khi engine lỗi. Load test 30k sp: 204 RPS, p99 78 ms.
- SDK `window.SearchApp` v1 (5,97 KB gzip) + UI (instant 2,23 KB, results 3,44 KB). Giá theo market: 1 request Storefront/trang (E2E đếm), node null ẩn, lỗi → "Xem giá".
- Theme extension: app embed nạp lười + 2 block in sẵn kết quả native & khung layout; Theme Check PASS; fallback khi engine/Storefront lỗi đã E2E.
- Merch: synonym 1/2 chiều, stop word, redirect, ghim/ẩn/boost/bury, rule theo collection (curation_tags), lịch hiệu lực.
- Phương án B (flag fixedMarketPrices): price_min_{cc} qua contextualPricing. Bản dịch: alias translations(locale:) trong bulk/incremental.
- Web pixel ẩn danh + rollup AnalyticsDaily. Lighthouse (fixture có trọng lượng theme): giảm có trọng số 0,4 điểm.
- Phát hiện quan trọng: Typesense 30 dùng `curation_tags` (override_tags bị bỏ qua); facet/filter/sort trên field động chưa tồn tại → lỗi; client typesense rò bộ nhớ khi import lớn; text_match_type max_score làm trọng số gần như vô hiệu.
- BFS: storefront chỉ qua theme app extension, không ScriptTag/Asset API; Lighthouse ≤ 5 (fixture; Horizon thật → G3).
- Cần store thật: HUMAN_TODO F1–F4 (giá market), G1–G3 (theme), H1–H2 (bản dịch, pixel).

## Tổng kết Phase 3 (2026-10-26)
- 10 trang admin (Home, Search, Sorting, Filters, Merchandising ×2, Appearance, Analytics, Sync, Developers, Plans), en + vi.
  Mẫu: component thuần app/components/*View.tsx (validate MCP polaris-app-home v2.0: tất cả VALID) + test SSR; route chỉ loader/action.
- DoD: Save Bar (ui-save-bar lập trình) trên mọi form; Thử tìm theo cấu hình chưa lưu; thêm metafield → cảnh báo + enqueue full sync;
  lưu → purge Redis + micro-cache search-api + CDN tag (≤ 1 phút); Appearance có preview iframe sandbox cạnh editor dùng đúng CSS/template widget.
- Analytics: top query, zero-result kèm nút tạo synonym/redirect (?new=), filter/sort usage. Sửa race rollup khi shop bị xoá giữa chừng.
- Developers: headless = gói ≥ Pro + merchant bật (mặc định tắt) + allowlist origin (tuỳ chọn); search-api trả 403 có mã lỗi rõ.
- Plans: Shopify App Pricing qua Partner API activeSubscription (không webhook → refresh khi mở trang + job đêm); vượt hạn mức chỉ báo info.
- Web Vitals admin (fixture + Polaris CDN, Desktop + Pixel 7, 22 trang): CLS p75 0.000 (max 0.061), LCP p75 ≤ 372 ms, không tràn ngang.
  Đã sửa CLS 0.28 ở Appearance (auto-fit → auto-fill). Field vitals thật gửi về /app/vitals.
- BFS phase 3: s-app-nav, Save Bar, s-table/s-modal/empty state, Home có setup + embed status + KPI, onboarding đóng được, live preview,
  không pattern gây áp lực, tính năng ngoài gói disable kèm giải thích.
- Còn thiếu so với nav mục 8: trang Help (support/FAQ) → làm cùng 6.5 (listing). Kiểm tra trên admin thật: HUMAN_TODO I1–I5, J1–J3.

## Tổng kết Phase 4 (2026-10-26)
- docs/developers: README (semver + deprecate ≥ 90 ngày), quickstart 4 mức, sdk-reference SINH từ .d.ts (CI --check), events,
  templates, headless, openapi.yaml 3.1 (test hợp đồng route/mã lỗi/$ref), CHANGELOG, 3 section mẫu (Theme Check sạch, E2E liquidjs).
- Contract SDK: snapshot v1.json + phân loại breaking/addition; đã chứng minh fail khi xoá field; dùng thật ở 5.2 (bump 1.1.0).
- Phát hiện quan trọng: section theme chạy TRƯỚC app embed (phải chờ DOMContentLoaded); searchapp-results.js từng vượt 10 000 B
  (Theme Check AssetSizeAppBlockJavaScript) → es2020 + tách template; ngân sách raw + Theme Check vào build/CI.

## Tổng kết Phase 5 (2026-10-26)
- 5.1 AI search hybrid (Typesense auto-embedding, gói Pro+, merchant bật, độ chặt → distance_threshold). 2.000 sp/4 s, query 3–5 ms.
- 5.2 Hiểu truy vấn bằng luật (giá en/vi + giá trị facet có thật), mọi gói, mặc định tắt; filter đưa lên URL để khách bỏ được;
  "Search for … instead". SDK 1.1.0.
- 5.3 Gợi ý synonym từ zero-result (dấu/khoảng trắng/số nhiều/chính tả/nghĩa), kiểm chứng có sản phẩm, merchant duyệt.
- Model embedding phải có sẵn trên Typesense (máy dev: tải tay vào /data/models; HUMAN_TODO K1).

## Tổng kết Phase 6 (2026-10-26)
- 6.1 Metrics Prometheus (search-api + worker, /metrics có token) + 7 alert rule + runbook.
- 6.2 Load ×10 (2.000 RPS origin, 0 lỗi) — sửa cạn pool Postgres (single-flight) + hệ số rate limit mùa cao điểm; HA 3 node
  (tắt leader: 0 lỗi); snapshot đêm + reindex-all khôi phục.
- 6.3 Security check 35/35 (5 subagent song song) — sửa bypass template merchant, href không an toàn, open redirect, scope
  thừa, index trang/bài viết thật, auth hiện rõ, override deepmerge-ts, dependabot.
- 6.4 Một image cho 3 process (smoke test thật), Render blueprint, compose self-host, hướng dẫn deploy + bảng env đầy đủ.
- 6.5 Hồ sơ App Store (listing có test giới hạn, 6 ảnh 1600×900, privacy policy đúng với code, hướng dẫn review), trang Help.
- 6.6 BFS checklist có bằng chứng (13/14; mục 14 sau khi lên store).
- Soát plan lần cuối phát hiện 2.15 (bán chạy theo đơn) chưa làm → đã làm đủ DoD.

## Bước tiếp theo
- Làm theo thứ tự `docs/FINAL_REPORT.md` mục 4 (HUMAN_TODO giai đoạn 1 → 4).
- Mẫu UI admin: component thuần trong app/components/*View.tsx (validate MCP polaris-app-home v2.0 + test SSR), route chỉ loader/action.

