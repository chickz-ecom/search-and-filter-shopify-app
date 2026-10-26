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
  TYPESENSE_SEARCH_ONLY_KEY: z.string().optional(),
  SEARCH_API_PORT: z.coerce.number().int().positive().default(8787),
  SEARCH_API_PUBLIC_URL: z.string().default("http://localhost:8787"),
  INTERNAL_API_SECRET: z.string().default(""),
  SEARCH_DEFAULT_LOCALE: z.string().default("en"),
  // Trang tài liệu developer đã publish (docs/developers) — HUMAN_TODO; trống thì ẩn link.
  DEVELOPER_DOCS_URL: z.string().default(""),
  SHOPIFY_API_KEY: z.string().default(""),
  SHOPIFY_API_SECRET: z.string().default(""),
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
