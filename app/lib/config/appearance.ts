import { z } from "zod";

// Appearance (task 3.6): token CSS + text theo locale + template ghi đè. Dùng chung admin (validate, preview) và
// storefront (áp CSS var). Giá trị token được whitelist chặt để không chèn được CSS/JS tuỳ ý.

const hex = z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/, "Use a hex color like #1a1a1a");

export const TokensSchema = z.object({
  accent: hex,
  text: hex,
  muted: hex,
  border: hex,
  background: hex,
  sale: hex,
  radius: z.number().int().min(0).max(24),
  gap: z.number().int().min(4).max(48),
  columns: z.number().int().min(2).max(6),
  showVendor: z.boolean(),
});
export type Tokens = z.infer<typeof TokensSchema>;

export const DEFAULT_TOKENS: Tokens = {
  accent: "#1a1a1a",
  text: "#1a1a1a",
  muted: "#6b6b6b",
  border: "#e3e3e3",
  background: "#ffffff",
  sale: "#b42318",
  radius: 8,
  gap: 16,
  columns: 4,
  showVendor: true,
};

/** Key text widget được phép ghi đè (khớp DEFAULT_TEXTS của search-service). */
export const TEXT_KEYS = [
  "placeholder",
  "noResults",
  "noResultsHint",
  "viewAll",
  "filters",
  "clearAll",
  "sortBy",
  "results",
  "loadMore",
  "soldOut",
  "sale",
  "viewPrice",
] as const;

export const TextsSchema = z.record(
  z.string().min(2).max(10),
  z.partialRecord(z.enum(TEXT_KEYS), z.string().max(200)),
);

/** Template ghi đè: không cho script/handler/javascript: (engine đã escape biến; đây là HTML do merchant viết). */
export const SafeTemplate = z
  .string()
  .max(20_000)
  .refine(
    (t) => !/<\s*script|<\s*iframe|\son[a-z]+\s*=|javascript:/i.test(t),
    "Templates can't contain scripts, event handlers or javascript: links",
  );

export const TemplatesSchema = z.object({
  "product-card": SafeTemplate.optional(),
  "suggest-item": SafeTemplate.optional(),
  empty: SafeTemplate.optional(),
});

export const AppearanceSchema = z.object({
  tokens: TokensSchema,
  texts: TextsSchema,
  templates: TemplatesSchema,
});
export type AppearanceConfig = z.infer<typeof AppearanceSchema>;

/** Giữ từng token hợp lệ, token sai/thiếu → mặc định. */
export function normalizeTokens(raw: unknown): Tokens {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_TOKENS } as Record<string, unknown>;
  for (const [k, schema] of Object.entries(TokensSchema.shape)) {
    const r = (schema as z.ZodType).safeParse(src[k]);
    if (r.success) out[k] = r.data;
  }
  return out as Tokens;
}

/** CSS custom properties cho widget (giống biến trong extensions/search-theme/assets/searchapp.css). */
export function tokensToCssVars(t: Tokens): Record<string, string> {
  return {
    "--sa-accent": t.accent,
    "--sa-text": t.text,
    "--sa-muted": t.muted,
    "--sa-border": t.border,
    "--sa-bg": t.background,
    "--sa-sale": t.sale,
    "--sa-radius": `${t.radius}px`,
    "--sa-gap": `${t.gap}px`,
    "--sa-cols": String(t.columns),
  };
}
