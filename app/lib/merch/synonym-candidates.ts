// Gợi ý synonym từ truy vấn 0 kết quả (task 5.3) — phần thuần: so truy vấn với từ vựng catalog của shop.
// Lý do theo độ chắc: dấu (accents) > khoảng trắng/gạch (spacing) > số ít/nhiều (plural) > chính tả (spelling).

export type CandidateReason = "accents" | "spacing" | "plural" | "spelling" | "meaning";
export type Candidate = { term: string; reason: CandidateReason };

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
const lower = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
const compact = (s: string) => fold(s).replace(/[\s\-_./]/g, "");

/** Khoảng cách Damerau–Levenshtein (hoán vị 2 ký tự liền kề = 1 lỗi). */
export function damerau(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const plural = (a: string, b: string) =>
  a === `${b}s` || a === `${b}es` || b === `${a}s` || b === `${a}es`;

const RANK: Record<CandidateReason, number> = {
  accents: 0,
  spacing: 1,
  plural: 2,
  spelling: 3,
  meaning: 4,
};

export function synonymCandidates(query: string, vocab: string[], max = 2): Candidate[] {
  const q = lower(query);
  const fq = fold(q);
  if (fq.length < 4) return [];
  const out = new Map<string, Candidate>();
  for (const term of vocab) {
    const t = lower(term);
    if (!t || t === q) continue;
    const ft = fold(t);
    let reason: CandidateReason | null = null;
    if (ft === fq) reason = "accents";
    else if (compact(t) === compact(q)) reason = "spacing";
    else if (plural(fq, ft)) reason = "plural";
    // Typesense đã sửa ≤ 2 lỗi cho từ đủ dài; truy vấn 0 kết quả nghĩa là lỗi vượt ngưỡng đó → cho phép ≤ 2 trên từ ≥ 5.
    else if (fq.length >= 5 && Math.abs(fq.length - ft.length) <= 2 && damerau(fq, ft) <= 2)
      reason = "spelling";
    if (!reason) continue;
    const key = ft;
    const prev = out.get(key);
    if (!prev || RANK[reason] < RANK[prev.reason]) out.set(key, { term, reason });
  }
  return [...out.values()].sort((a, b) => RANK[a.reason] - RANK[b.reason]).slice(0, max);
}
