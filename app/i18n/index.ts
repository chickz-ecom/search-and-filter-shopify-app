import { en, type MessageKey } from "./en";
import { vi } from "./vi";

export type Locale = "en" | "vi";
const catalogs: Record<Locale, Record<MessageKey, string>> = { en, vi };

export function resolveLocale(input?: string | null): Locale {
  const l = (input ?? "").toLowerCase();
  return l.startsWith("vi") ? "vi" : "en";
}

/**
 * Locale của admin: tham số `locale` trên URL app nhúng, rồi Accept-Language.
 * VERIFY: Shopify admin thêm `locale` vào query khi tải app (HUMAN_TODO C4).
 */
export function localeFromRequest(request: Request): Locale {
  const q = new URL(request.url).searchParams.get("locale");
  if (q) return resolveLocale(q);
  return resolveLocale(request.headers.get("accept-language")?.split(",")[0]);
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const msg = catalogs[locale][key] ?? en[key] ?? key;
  return vars
    ? msg.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
    : msg;
}

export function translator(locale: Locale) {
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export type { MessageKey };
