# PROGRESS — Shopify Search & Filter app

> Đọc file này đầu tiên khi tiếp tục phiên. Nguồn sự thật: `docs/02-PLAN.md` (checkbox + Nhật ký).
> Tiếp tục: `cat docs/PROGRESS.md && git log --oneline -20 && grep -n "\[ \]\|\[~\]" docs/02-PLAN.md | head`

## Hiện tại
- Phase: 0 — Khởi tạo
- Task: 0.1

## Đã xong
- Bước 0: đọc tài liệu, git init, kiểm tra môi trường.

## Bị chặn / `[~]`
- (chưa có)

## Quyết định tự đưa ra
- Môi trường dev **tái sử dụng Docker sẵn có** của user: Postgres `postgres_db` (pg15, :5432, admin/password) với DB riêng `search_app` + `search_app_test`; Redis `docker-redis-1` (127.0.0.1:6379) dùng DB index 5 và prefix `sa:`. `docker-compose.yml` của dự án chỉ chạy Typesense; postgres/redis nằm sau profile `standalone` (CI hoặc máy khác).
- Node local là v23.11.1 (≥ 22.12, chạy được); engines giữ `>=22.12`, CI/Docker dùng Node 22.
- Template React Router được clone bằng git (không cần đăng nhập Partner); `shopify.web.toml` render tay cho npm.
- Commit `package-lock.json` (template ignore lockfile; ta cần build tái lập được).
- Tra API Shopify bằng Shopify Dev MCP (`@shopify/dev-mcp`, gọi qua client stdio nhỏ) — có tool `validate` để kiểm GraphQL/Polaris/Liquid với schema thật.

## Môi trường
- node v23.11.1 · npm 10.9.2 · Shopify CLI 4.9.4 (chưa đăng nhập) · Docker 24.0.7 · git 2.50.1

## Bước tiếp theo
- 0.1: dựng template, nâng `@shopify/shopify-app-react-router@^4`, `@shopify/polaris-types@^2`, pin `react-router@7`.
