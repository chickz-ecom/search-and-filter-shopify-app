# Architecture Decision Records

| # | Quyết định | File |
|---|---|---|
| D1 | Shopify React Router v7 template | [0001-shopify-react-router-template.md](0001-shopify-react-router-template.md) |
| D2 | Polaris web components 2.x + App Bridge CDN | [0002-polaris-web-components.md](0002-polaris-web-components.md) |
| D3 | PostgreSQL + Prisma | [0003-postgresql-prisma.md](0003-postgresql-prisma.md) |
| D4 | Redis + BullMQ cho queue sync và cache | [0004-redis-bullmq.md](0004-redis-bullmq.md) |
| D5 | Typesense sau interface SearchEngine | [0005-typesense-search-engine.md](0005-typesense-search-engine.md) |
| D6 | Mỗi shop một collection + alias | [0006-per-shop-collection-alias.md](0006-per-shop-collection-alias.md) |
| D7 | Webhook → queue → lấy lại dữ liệu qua GraphQL | [0007-webhooks-enqueue-refetch.md](0007-webhooks-enqueue-refetch.md) |
| D8 | Events API cho thay đổi collection | [0008-events-api-collections.md](0008-events-api-collections.md) |
| D9 | Search API riêng (Hono) | [0009-separate-search-api.md](0009-separate-search-api.md) |
| D10 | Storefront chỉ qua theme app extension | [0010-theme-app-extension-only.md](0010-theme-app-extension-only.md) |
| D11 | Render progressive (Liquid trước, JS hydrate) | [0011-progressive-rendering.md](0011-progressive-rendering.md) |
| D12 | Billing qua Shopify managed pricing theo số sản phẩm | [0012-managed-pricing.md](0012-managed-pricing.md) |
| D13 | Analytics ẩn danh | [0013-anonymous-analytics.md](0013-anonymous-analytics.md) |
| D14 | API version 2026-10 một chỗ | [0014-api-version-2026-10.md](0014-api-version-2026-10.md) |
| D15 | Giá hiển thị từ Storefront API (1 request/trang) | [0015-storefront-api-pricing.md](0015-storefront-api-pricing.md) |
| D16 | Storefront SDK công khai `window.SearchApp` | [0016-public-storefront-sdk.md](0016-public-storefront-sdk.md) |

Đổi quyết định: thêm ADR mới (Superseded), cập nhật bảng D-x trong 02-PLAN.md và Nhật ký.
