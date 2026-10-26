import type { Locale } from "../../i18n";

/** Định dạng số liệu Analytics theo ngôn ngữ admin và currency gốc của shop. */
export function formatters(locale: Locale, currency: string) {
  const tag = locale === "vi" ? "vi-VN" : "en-US";
  const nf = new Intl.NumberFormat(tag);
  const mf = new Intl.NumberFormat(tag, { style: "currency", currency });
  const df = new Intl.DateTimeFormat(tag, { month: "short", day: "numeric", timeZone: "UTC" });
  const dfy = new Intl.DateTimeFormat(tag, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return {
    num: (n: number) => nf.format(n),
    money: (n: number) => mf.format(n),
    pct: (n: number) => `${nf.format(Math.round(n * 1000) / 10)}%`,
    /** "Oct 3" cho trục biểu đồ. */
    day: (iso: string) => df.format(new Date(`${iso}T00:00:00Z`)),
    /** "Oct 3, 2026" cho nút khoảng ngày. */
    date: (iso: string) => dfy.format(new Date(`${iso}T00:00:00Z`)),
  };
}
