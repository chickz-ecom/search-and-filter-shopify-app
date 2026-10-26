Bạn là kỹ sư chính của dự án này. Nhiệm vụ: xây hoàn chỉnh app Shopify Search & Filter theo `docs/02-PLAN.md`, từ Phase 0 đến hết Phase 6, **liên tục, không dừng lại để hỏi tôi**.

## Bước 0: Đọc và chuẩn bị
1. Đọc `CLAUDE.md`, `docs/01-RESEARCH.md` và `docs/02-PLAN.md`. Plan là nguồn sự thật: D1–D16, kiến trúc, DoD từng task, checklist BFS.
2. Nếu chưa có thì `git init`. Tạo `docs/PROGRESS.md` gồm:
   - Phase và task hiện tại.
   - Task đã xong, task bị chặn.
   - Các quyết định đã tự đưa ra.
   - Bước tiếp theo.
   File này dùng để bạn (hoặc phiên sau) đọc lại và tiếp tục khi context bị reset.
3. Kiểm tra môi trường bằng `node -v` (cần ≥ 22.12), `shopify version`, `docker --version`, `git --version`. Thiếu công cụ nào thì cài nếu được (npm), không cài được thì ghi vào `docs/HUMAN_TODO.md`.

## Quy tắc làm việc liên tục
- **Không hỏi tôi.** Câu hỏi mở ở mục 13 của plan thì dùng mặc định dưới đây, ghi vào mục Nhật ký của plan và làm tiếp:
  1. Typesense self-host bằng docker cho dev; viết cấu hình deploy cho Typesense Cloud **và** cho self-host.
  2. UI admin có tiếng Anh và tiếng Việt; search tối ưu cho tiếng Anh trước, có cấu hình locale.
  3. Gói giá: Free < 100 sản phẩm · $9 (1k) · $19 (5k) · $49 (30k) · $99 (100k) · $199 (300k).
  4. Markets: làm quy đổi tự động trước. Phương án B (price list cố định) đặt sau feature flag `fixedMarketPrices`.
  5. Headless API mở cho gói từ $49.
- **Việc cần con người** (đăng nhập Shopify CLI/Partner, tạo dev store, tài khoản cloud, DNS, secret thật, nộp App Store): ghi vào `docs/HUMAN_TODO.md`, kèm lệnh hoặc bước chính xác. **Sau đó làm tiếp phần không bị chặn:**
  - Dùng fixture JSONL hoặc GraphQL mock cho Shopify.
  - Dùng docker cho Postgres, Redis, Typesense.
  - Dùng `.env.example` với giá trị giả.
  - Viết test để chứng minh logic đúng.
  - Không được bỏ dở task chỉ vì thiếu kết nối Shopify thật.
- **Lỗi và test fail:** tự debug (đọc lỗi, tìm nguyên nhân gốc, sửa, chạy lại). Thử tối đa 3 cách khác nhau. Vẫn không được thì ghi vào PROGRESS kèm giả thuyết, đánh dấu task `[~]`, chuyển sang task tiếp theo không phụ thuộc. Hết lượt task thì quay lại xử lý.
- **Không đoán API Shopify.** Trước khi viết code gọi Admin API, Storefront API, App Bridge, Polaris hay theme extension, tra cứu shopify.dev (hoặc Shopify Dev MCP nếu template có sẵn `.mcp.json`). Có kết nối thì validate query bằng `shopify app execute` hoặc GraphiQL. Không có thì ghi chú `// VERIFY:` và thêm vào HUMAN_TODO.
- **Không dùng:** `@shopify/polaris` React, REST Admin API, ScriptTag, ghi Asset API, `ui-nav-menu`, React Router 8, SQLite ở production, `Shopify.currency.rate`.

## Vòng lặp cho mỗi task (theo đúng thứ tự trong plan)
1. Ghi task hiện tại vào PROGRESS.
2. Với logic (mapper, query/sort/filter builder, pricing, template engine, HMAC, sync): viết test trước.
3. Code theo plan và các quyết định D-x.
4. Chạy `npm run typecheck && npm run lint && npm test` (và Playwright nếu task có UI). Tất cả phải pass.
5. Đối chiếu DoD của task. Phần DoD cần Shopify thật thì viết test tương đương bằng mock, và ghi phần kiểm chứng thật vào HUMAN_TODO.
6. Tick `[x]` trong `docs/02-PLAN.md`, ghi một dòng vào Nhật ký, cập nhật PROGRESS.
7. Commit: `git commit -m "phase<X>.<Y>: <mô tả ngắn>"`.
8. Sang task tiếp theo ngay.

**Cuối mỗi phase:**
- Chạy toàn bộ test.
- Soát lại DoD của phase và các mục BFS liên quan (mục 11).
- Viết tóm tắt phase vào PROGRESS, rồi sang phase sau.

## Quản lý context (phiên dài)
- Không đọc lại nguyên các file lớn. Dùng grep hoặc đọc theo đoạn.
- Việc nghiên cứu hoặc tra tài liệu rộng thì giao cho subagent và chỉ lấy kết luận.
- Nếu context bị nén hoặc reset: đọc `docs/PROGRESS.md`, `git log --oneline -20` và các checkbox trong plan, rồi tiếp tục từ task chưa xong đầu tiên. **Không làm lại từ đầu.**

## Hoàn thành
Chỉ dừng khi **mọi task Phase 0–6 đều đã `[x]`**, hoặc bị chặn bởi việc trong HUMAN_TODO và đã có bản mock/test thay thế. Khi đó viết `docs/FINAL_REPORT.md` gồm:
- Đã làm gì, kiến trúc thực tế.
- Kết quả test, bundle size, kết quả benchmark sync.
- Danh sách HUMAN_TODO theo thứ tự cần làm để chạy thật trên dev store rồi nộp App Store và BFS.
- Rủi ro còn lại, và các ghi chú `// VERIFY:` cần kiểm tra.

Bắt đầu ngay với Bước 0.
