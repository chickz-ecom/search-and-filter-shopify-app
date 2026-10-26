import type { AppliedFilters } from "./filters";

// Hiểu truy vấn (task 5.2): "váy đỏ dưới 500k" → q "váy" + filter màu Đỏ + giá ≤ 500.000. Luật xác định (không
// LLM): rẻ, đoán trước được, test được. Chỉ dùng giá trị CÓ THẬT trong facet của shop (vocabulary) và cụm giá có dấu
// hiệu rõ ràng (từ khoá hoặc đơn vị). Không khớp được gì → null (giữ nguyên truy vấn).

export type Vocabulary = { filterId: string; values: string[] }[];
export type UnderstandOptions = {
  vocab: Vocabulary;
  /** Filter giá đang bật ở phạm vi này (undefined → không hiểu giá). */
  priceFilterId?: string;
  /** Currency của giá trong filter (shop hoặc market cố định). */
  currency: string;
};
export type Understood = { query: string; filters: AppliedFilters };

const MARKS = /[̀-ͯ]/g;
/** Bỏ dấu + chữ thường, giữ 1 ký tự ↔ 1 ký tự. */
const fold = (s: string) => s.normalize("NFD").replace(MARKS, "").replace(/đ/gi, "d").toLowerCase();
const hasMarks = (s: string) => fold(s) !== s.toLowerCase();

const MAX_CUES = [
  "under",
  "below",
  "less than",
  "cheaper than",
  "up to",
  "max",
  "maximum",
  "<",
  "<=",
  "duoi",
  "nho hon",
  "re hon",
  "khong qua",
  "toi da",
  "it hon",
];
const MIN_CUES = [
  "over",
  "above",
  "more than",
  "at least",
  "min",
  "minimum",
  ">",
  ">=",
  "tren",
  "hon",
  "it nhat",
  "toi thieu",
];
const RANGE_START = ["between", "from", "tu"];
const RANGE_JOIN = ["and", "to", "-", "–", "den", "toi"];
const PRICE_FILLER = ["price", "gia", "for"];
const ATTR_FILLER = ["size", "co", "mau", "color", "colour", "hang", "brand", "by", "thuong hieu"];

const CURRENCY: Record<string, string> = {
  $: "USD",
  usd: "USD",
  "€": "EUR",
  eur: "EUR",
  "£": "GBP",
  gbp: "GBP",
  d: "VND",
  vnd: "VND",
  dong: "VND",
};
const MULT: Record<string, number> = { k: 1e3, nghin: 1e3, ngan: 1e3, tr: 1e6, trieu: 1e6, m: 1e6 };
const NUM_RE =
  /^([$€£])?(\d+(?:[.,]\d+)*)(k|tr|trieu|nghin|ngan|m)?([$€£]|d|usd|vnd|eur|gbp|dong)?$/;
const UNIT_RE = /^(usd|vnd|eur|gbp|dong|d|k|tr|trieu|nghin|ngan|[$€£])$/;

type Num = { value: number; currency?: string; unit: boolean; end: number };

function parseDigits(s: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  return Number(s.replace(",", "."));
}

function readNumber(ft: string[], i: number): Num | null {
  const m = ft[i] && NUM_RE.exec(ft[i]);
  if (!m) return null;
  let value = parseDigits(m[2]);
  let currency = CURRENCY[m[1] ?? ""] ?? CURRENCY[m[4] ?? ""];
  let unit = Boolean(m[1] || m[3] || m[4]);
  if (m[3]) value *= MULT[m[3]];
  let end = i + 1;
  // Đơn vị tách rời: "50 usd", "1 triệu", "200 nghìn".
  const next = ft[end];
  if (next && UNIT_RE.test(next)) {
    if (MULT[next]) value *= MULT[next];
    else currency = CURRENCY[next];
    unit = true;
    end++;
  }
  return Number.isFinite(value) ? { value, currency, unit, end } : null;
}

/** Cụm từ khoá 1–2 token bắt đầu tại i → số token. */
function cue(ft: string[], i: number, list: string[]): number {
  if (ft[i + 1] && list.includes(`${ft[i]} ${ft[i + 1]}`)) return 2;
  return list.includes(ft[i]) ? 1 : 0;
}

type Price = { min?: number; max?: number; start: number; end: number; currency?: string };

function findPrice(ft: string[]): Price | null {
  for (let i = 0; i < ft.length; i++) {
    const start = i > 0 && PRICE_FILLER.includes(ft[i - 1]) ? i - 1 : i;
    // "between 20 and 50", "từ 200k đến 1,5tr"
    const rs = cue(ft, i, RANGE_START);
    if (rs) {
      const a = readNumber(ft, i + rs);
      const j = a ? cue(ft, a.end, RANGE_JOIN) : 0;
      const b = a && j ? readNumber(ft, a.end + j) : null;
      if (a && b)
        return {
          min: a.value,
          max: b.value,
          start,
          end: b.end,
          currency: a.currency ?? b.currency,
        };
    }
    // "$20-$40", "20 to 50 usd" — cần đơn vị/ký hiệu để không nhầm kích cỡ.
    const parts = ft[i].split(/[-–]/);
    if (parts.length === 2) {
      const a = readNumber(parts, 0);
      const b = readNumber(parts, 1);
      if (a && b && (a.unit || b.unit))
        return {
          min: a.value,
          max: b.value,
          start,
          end: i + 1,
          currency: a.currency ?? b.currency,
        };
    }
    const n = readNumber(ft, i);
    if (n) {
      const j = cue(ft, n.end, RANGE_JOIN);
      const b = j ? readNumber(ft, n.end + j) : null;
      if (b && (n.unit || b.unit))
        return {
          min: n.value,
          max: b.value,
          start,
          end: b.end,
          currency: n.currency ?? b.currency,
        };
    }
    const mx = cue(ft, i, MAX_CUES);
    const vmx = mx ? readNumber(ft, i + mx) : null;
    if (vmx) return { max: vmx.value, start, end: vmx.end, currency: vmx.currency };
    const mn = cue(ft, i, MIN_CUES);
    const vmn = mn ? readNumber(ft, i + mn) : null;
    if (vmn) return { min: vmn.value, start, end: vmn.end, currency: vmn.currency };
  }
  return null;
}

export function understandQuery(q: string, opts: UnderstandOptions): Understood | null {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const ft = tokens.map(fold);
  const used = new Array<boolean>(tokens.length).fill(false);
  const filters: AppliedFilters = {};

  if (opts.priceFilterId) {
    const p = findPrice(ft);
    if (p && (!p.currency || p.currency === opts.currency)) {
      filters[opts.priceFilterId] = {
        ...(p.min !== undefined ? { min: p.min } : {}),
        ...(p.max !== undefined ? { max: p.max } : {}),
      };
      for (let k = p.start; k < p.end; k++) used[k] = true;
    }
  }

  // Giá trị facet: n-gram dài trước (3 → 1 token).
  const index = new Map<string, { filterId: string; value: string }>();
  for (const v of opts.vocab)
    for (const value of v.values) {
      const key = fold(value).trim();
      if (key && !index.has(key)) index.set(key, { filterId: v.filterId, value });
    }
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const hit = index.get(ft.slice(i, i + n).join(" "));
      if (!hit) continue;
      const fillerLen =
        i >= 2 && ATTR_FILLER.includes(`${ft[i - 2]} ${ft[i - 1]}`)
          ? 2
          : i >= 1 && ATTR_FILLER.includes(ft[i - 1])
            ? 1
            : 0;
      const short = fold(hit.value).length <= 2;
      if (short) {
        // Giá trị ngắn dễ trùng từ thường ("do", "m"): có dấu → phải đúng dấu; không dấu → cần từ dẫn ("size xl").
        const exact =
          tokens
            .slice(i, i + n)
            .join(" ")
            .toLowerCase() === hit.value.toLowerCase();
        if (hasMarks(hit.value) ? !exact : !fillerLen) continue;
      }
      const cur = filters[hit.filterId];
      const list = Array.isArray(cur) ? cur : [];
      if (!list.includes(hit.value)) filters[hit.filterId] = [...list, hit.value];
      for (let k = i - fillerLen; k < i + n; k++) if (k >= 0 && !used[k]) used[k] = true;
    }
  }

  if (!Object.keys(filters).length) return null;
  return { query: tokens.filter((_, k) => !used[k]).join(" "), filters };
}
