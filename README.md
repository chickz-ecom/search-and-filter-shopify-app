# Search & Filter — Shopify app

App Shopify public thay ô tìm kiếm, trang kết quả search và trang collection của theme bằng search nhanh hơn,
có bộ lọc, sắp xếp, merchandising (synonym, redirect, ghim/ẩn/đẩy sản phẩm), analytics và SDK cho theme developer.
Mục tiêu: lên App Store và đạt **Built for Shopify**.

- Merchant cấu hình trong Shopify admin (app nhúng, Polaris web components).
- Storefront dùng theme app extension (app embed + 2 app block) và web pixel. Không dùng ScriptTag, không ghi Asset API.
- Đội vận hành quản lý gói, shop và nhân viên ở back-office riêng `/admin`.

## Kiến trúc

```
Shopify ──bulk/GraphQL──▶ worker (BullMQ) ──▶ Typesense (index sản phẩm theo shop, alias p_{shopId})
   │  webhook/events          ▲   │
   ▼                          │   └──▶ Postgres (cấu hình, analytics rollup, phiên, job)
app React Router ── enqueue ──┘
   ├─ /app/*        admin nhúng trong Shopify (Search, Filters, Sorting, Merchandising, Analytics, Sync…)
   ├─ /proxy/*      app proxy → search API (same-origin cho storefront)
   ├─ /webhooks/*   xác thực HMAC → dedupe → enqueue, trả 200 nhanh
   └─ /admin/*      back-office nội bộ (đăng nhập riêng)
search-api (services/search-api) — cùng API, chạy riêng sau CDN cho storefront/headless
storefront: app embed (SDK window.SearchApp + ô gợi ý) · block Search results / Collection filters · web pixel
```

Sản phẩm không lưu trong Postgres: Typesense là bản sao để search. Shopify là nguồn dữ liệu gốc, index dựng lại được bất cứ lúc nào
(full sync, webhook, quét bù 5 phút, đối soát đêm). Chi tiết và các quyết định D1–D17: [docs/02-PLAN.md](docs/02-PLAN.md).

## Công nghệ

| Phần | Dùng |
|---|---|
| App | Node 22, TypeScript, React Router 7 (`@shopify/shopify-app-react-router` 4) |
| Admin UI | Polaris web components (`s-*`) + App Bridge; biểu đồ Polaris Viz. **Không** dùng `@shopify/polaris` React |
| Shopify API | Admin GraphQL `2026-10` (không REST), Storefront API cho giá theo market |
| Dữ liệu | PostgreSQL + Prisma · Redis + BullMQ · Typesense 30.1 (qua interface `SearchEngine`) |
| Thu tiền | Shopify App Pricing (gói đặt ở Partner Dashboard; quyền lợi theo gói quản lý ở back-office) |
| Test | Vitest (unit + integration với dịch vụ thật), Playwright (E2E storefront + admin) |

## Chạy local

### 1. Chuẩn bị

- Node ≥ 22.12, Docker, [Shopify CLI](https://shopify.dev/docs/api/shopify-cli), một dev store.
- Postgres và Redis: dùng container có sẵn trên máy, hoặc bật kèm bằng profile `standalone`.

```bash
npm install
docker compose up -d                          # chỉ Typesense (Postgres/Redis dùng container sẵn có)
# hoặc: docker compose --profile standalone up -d   # Typesense + Postgres + Redis
cp .env.example .env                          # điền giá trị; secret chỉ lấy từ env, không commit
npm run setup                                 # prisma generate + migrate deploy
```

Biến môi trường quan trọng (đủ danh sách và giải thích trong [.env.example](.env.example)):

| Biến | Dùng cho |
|---|---|
| `DATABASE_URL`, `REDIS_URL`, `REDIS_PREFIX` | Postgres, Redis (dev dùng DB/prefix riêng để không đụng app khác) |
| `TYPESENSE_*` | Kết nối Typesense; `TYPESENSE_SEARCH_ONLY_KEY` để sinh key search theo shop |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL` | CLI tự điền khi `shopify app dev` |
| `ADMIN_SESSION_SECRET` | Back-office `/admin` (≥ 32 ký tự). Trống → `/admin` trả 404 |
| `SHOPIFY_PARTNER_*`, `SHOPIFY_APP_GID` | Đọc gói hiện tại của shop qua Partner API (không có → dùng gói đã lưu) |

### 2. Chạy

Cần đủ 4 tiến trình: Postgres, Redis, Typesense và worker, cộng với app.

```bash
npm run dev          # build JS storefront + shopify app dev (tunnel của CLI)
npm run dev:tiep     # như trên, dùng tunnel cố định search.tiepdo.online
npm run worker       # sync, rollup analytics, job định kỳ — thiếu worker thì sync đứng ở "Queued"
npm run search-api   # (tuỳ chọn) search API chạy riêng như production; dev đi qua app proxy /proxy
```

Lần đầu mở app trên dev store: bật app embed **Search & Filter** trong theme editor, thêm block **Search results** (template
Search) và **Collection filters** (template Collection). Trang Home của app có nút dẫn thẳng tới từng bước.

Staging: `.env.stag` + `npm run dev:stag`, `npm run deploy:stag`, `npm run worker:stag` (cấu hình `shopify.app.staging.toml`).

### 3. Back-office

```bash
npm run admin:create-agent -- --email you@example.com --name "Tên bạn"   # Owner đầu tiên, mật khẩu in ra một lần
```

Mở `<SHOPIFY_APP_URL>/admin/login`. Gồm Dashboard, Plans, Shops, Agents, Roles, Audit log. Handle gói ở Plans phải trùng
handle gói ở Partner Dashboard.

## Kiểm thử

```bash
npm run typecheck && npm test   # bắt buộc pass trước khi đánh dấu xong một task (CLAUDE.md)
npm run test:e2e                # Playwright: storefront (desktop + mobile) và layout/Web Vitals của admin
npm run lint && npm run format:check
```

- Test tích hợp (`*.int.test.ts`) chạy trên Postgres/Redis/Typesense thật và **tự skip** khi thiếu dịch vụ. DB test riêng:
  `npm run db:test:push` (đọc `.env.test`; đừng nạp `.env` của dev trong cùng shell, `dotenv-cli` không ghi đè biến đã có).
- `npm run build:storefront` kiểm tra ngân sách JS storefront (≤ 10 KB gzip mỗi block).
- Hợp đồng SDK `window.SearchApp` có snapshot: đổi chữ ký → cập nhật `docs/developers/`, changelog và `npm run sdk:snapshot`.
- Kịch bản kiểm thử thủ công cho tester: [docs/qa/test-plan.md](docs/qa/test-plan.md).

## Cấu trúc thư mục

```
app/
  routes/          app.* (admin nhúng) · admin.* (back-office) · webhooks.* · proxy.$ · api.events.*
  components/      view của từng trang admin (render được độc lập để test/E2E)
  lib/
    sync/          full sync (bulk), incremental, delta, checksum, reindex, tiến độ
    search/        SearchEngine + Typesense, schema index, dựng query/filter/sort
    search-service/ search API dùng chung app proxy + search-api, analytics, rollup
    analytics/     báo cáo Analytics v2, khoảng ngày, CSV
    billing/       gói, quyền lợi (entitlements), Partner API
    backoffice/    đăng nhập nhân viên, quyền, audit, quản lý gói/shop
    merch/ config/ admin/ shop/ webhooks/ queue/ i18n …
extensions/
  search-theme/    app embed + block Liquid, asset JS/CSS (build từ packages/)
  search-pixel/    web pixel (add to cart, đơn hàng → analytics)
packages/
  storefront-sdk/  window.SearchApp (SDK v1, có contract snapshot)
  storefront-ui/   widget kết quả + ô gợi ý
services/search-api/  search API chạy riêng (Hono)
workers/           tiến trình BullMQ
prisma/            schema + migrations
e2e/ test/         Playwright, fixture, helper test
docs/              kế hoạch, nghiên cứu, vận hành, tài liệu developer/merchant, QA
deploy/            cấu hình triển khai (Render, self-host, Typesense HA, observability)
```

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Quy tắc làm việc trong repo (stack cố định, webhook, ngân sách JS, SDK…) |
| [docs/02-PLAN.md](docs/02-PLAN.md) | Kiến trúc, quyết định, lộ trình theo phase, nhật ký |
| [docs/01-RESEARCH.md](docs/01-RESEARCH.md) | Cách các app đối thủ index/sync/search, chuẩn Shopify |
| [docs/HUMAN_TODO.md](docs/HUMAN_TODO.md) | Việc cần người làm (Partner Dashboard, secret, deploy, nộp App Store) |
| [docs/ops/](docs/ops/) | Deploy, quan sát, bảo mật, tải và HA, checklist BFS |
| [docs/developers/](docs/developers/README.md) | SDK, events, template, headless API, OpenAPI, changelog |
| [docs/merchants/getting-started.md](docs/merchants/getting-started.md) | Hướng dẫn cho merchant |
| [docs/SUBSCRIPTION.md](docs/SUBSCRIPTION.md) | Đề xuất bảng giá |
| [docs/qa/test-plan.md](docs/qa/test-plan.md) | Kịch bản kiểm thử thủ công |
| [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md) | Báo cáo tổng kết Phase 0–6 |
