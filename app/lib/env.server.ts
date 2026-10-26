import { z } from "zod";

// Bí mật chỉ lấy từ env (CLAUDE.md). Một chỗ duy nhất đọc process.env cho lib/worker/search-api.
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  REDIS_PREFIX: z.string().min(1).default("sa"),
  TYPESENSE_HOST: z.string().min(1).default("localhost"),
  TYPESENSE_PORT: z.coerce.number().int().positive().default(8108),
  TYPESENSE_PROTOCOL: z.enum(["http", "https"]).default("http"),
  TYPESENSE_API_KEY: z.string().min(1),
  // HA (task 6.2): danh sách node "https://ts1.example.com:443,https://ts2…" — có thì thay TYPESENSE_HOST/PORT/PROTOCOL.
  TYPESENSE_NODES: z.string().default(""),
  // Backup (6.2): thư mục snapshot TRÊN máy Typesense, vd. /data/snapshots → job đêm ghi /data/snapshots/YYYY-MM-DD.
  TYPESENSE_SNAPSHOT_DIR: z.string().default(""),
  TYPESENSE_SEARCH_ONLY_KEY: z.string().optional(),
  SEARCH_API_PORT: z.coerce.number().int().positive().default(8787),
  SEARCH_API_PUBLIC_URL: z.string().default("http://localhost:8787"),
  INTERNAL_API_SECRET: z.string().default(""),
  // Bearer token cho GET /metrics của search-api và worker (Prometheus scrape). Trống → tắt.
  METRICS_TOKEN: z.string().default(""),
  SEARCH_DEFAULT_LOCALE: z.string().default("en"),
  // Model embedding của Typesense cho AI search (task 5.1). Mặc định model built-in tiếng Anh; đa ngôn ngữ:
  // ts/paraphrase-multilingual-mpnet-base-v2. Máy không ra được internet → tải sẵn vào <data-dir>/models (HUMAN_TODO).
  TYPESENSE_EMBED_MODEL: z.string().default("ts/all-MiniLM-L12-v2"),
  // Trang tài liệu developer đã publish (docs/developers) — HUMAN_TODO; trống thì ẩn link.
  DEVELOPER_DOCS_URL: z.string().default(""),
  // Email hỗ trợ (trang Help, hồ sơ App Store) — HUMAN_TODO N1.
  SUPPORT_EMAIL: z.string().default("support@example.com"),
  SHOPIFY_API_KEY: z.string().default(""),
  SHOPIFY_API_SECRET: z.string().default(""),
  // Shopify App Pricing (task 3.9): handle trong shopify.app.toml + Partner API (HUMAN_TODO J).
  SHOPIFY_APP_HANDLE: z.string().default("smart-search-filter"),
  SHOPIFY_APP_GID: z.string().default(""),
  SHOPIFY_PARTNER_ORG_ID: z.string().default(""),
  SHOPIFY_PARTNER_API_TOKEN: z.string().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
