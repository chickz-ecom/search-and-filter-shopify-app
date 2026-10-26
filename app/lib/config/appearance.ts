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
  "interpreted",
  "searchInstead",
] as const;

export const TextsSchema = z.record(
  z.string().min(2).max(10),
  z.partialRecord(z.enum(TEXT_KEYS), z.string().max(200)),
);

/** Template ghi đè: không cho script/handler/javascript: (engine đã escape biến; đây là HTML do merchant viết). */
/**
 * Kiểm tra template merchant theo DANH SÁCH CHO PHÉP (security check 6.3 TEXT_SETTING_HTML_SMUGGLING: regex cũ bỏ lọt
 * "<img/onerror=…>"). Trả mô tả vấn đề đầu tiên, hoặc null nếu an toàn. Placeholder {{…}} được bỏ trước khi kiểm.
 */
const TEMPLATE_TAGS = new Set(
  "a abbr b br del div em figcaption figure h2 h3 h4 h5 h6 hr i img ins li mark ol p picture s small source span strong sub sup ul".split(
    " ",
  ),
);
const TEMPLATE_ATTR =
  /^(class|id|href|src|srcset|sizes|alt|title|width|height|loading|decoding|role|style|rel|target|aria-[a-z-]+|data-[a-z0-9-]+)$/;
const URL_ATTRS = new Set(["href", "src", "srcset"]);
const decodeEntities = (v: string) =>
  v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;|&newline;/gi, "");

export function templateProblem(template: string): string | null {
  const t = template.replace(/\{\{[\s\S]*?\}\}/g, "");
  if (/<!(?!--)|<\?/.test(t)) return "Declarations and processing instructions aren't allowed";
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(t))) {
    const tag = m[2].toLowerCase();
    if (!TEMPLATE_TAGS.has(tag)) return `The <${tag}> tag isn't allowed in templates`;
    if (m[1]) continue;
    const attrRe = /([^\s"'=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[3]))) {
      const name = a[1].toLowerCase();
      if (!TEMPLATE_ATTR.test(name)) return `The "${name}" attribute isn't allowed in templates`;
      const value = decodeEntities((a[2] ?? "").replace(/^["']|["']$/g, "")).replace(
        // eslint-disable-next-line no-control-regex -- cố ý: loại ký tự điều khiển khỏi URL (security 6.3)
        /[\s\u0000-\u001f]/g,
        "",
      );
      if (URL_ATTRS.has(name) && /^(javascript|data|vbscript):/i.test(value))
        return "Links must use http(s) or a path";
      if (name === "style" && /url\(|expression|@import|\\/i.test(value))
        return "Styles can't load URLs";
    }
  }
  return null;
}

export const SafeTemplate = z
  .string()
  .max(20_000)
  .superRefine((t, ctx) => {
    const problem = templateProblem(t);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

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
