// Khoảng ngày của trang Analytics (7.2): `?from=YYYY-MM-DD&to=YYYY-MM-DD` (gồm cả hai đầu, theo UTC như bảng rollup).

export type DateRange = { from: string; to: string };
export type Preset =
  "today" | "yesterday" | "last7" | "last30" | "last90" | "thisMonth" | "lastMonth";
export const PRESETS: Preset[] = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "last90",
  "thisMonth",
  "lastMonth",
];

const DAY = 24 * 3600_000;
const MAX_DAYS = 366;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** "YYYY-MM-DD" hợp lệ (kể cả ngày có thật trong tháng) → Date 00:00 UTC. */
function parseDay(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || iso(d) !== v ? null : d;
}

export function presetRange(p: Preset, now = new Date()): DateRange {
  const today = utcDay(now);
  const back = (n: number) => ({
    from: iso(new Date(today.getTime() - (n - 1) * DAY)),
    to: iso(today),
  });
  switch (p) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "yesterday": {
      const y = iso(new Date(today.getTime() - DAY));
      return { from: y, to: y };
    }
    case "last7":
      return back(7);
    case "last90":
      return back(90);
    case "thisMonth":
      return {
        from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
        to: iso(today),
      };
    case "lastMonth": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { from: iso(first), to: iso(last) };
    }
    default:
      return back(30);
  }
}

export function parseDateRange(params: URLSearchParams, now = new Date()): DateRange {
  let a = parseDay(params.get("from"));
  let b = parseDay(params.get("to"));
  if (!a || !b) return presetRange("last30", now);
  if (a > b) [a, b] = [b, a];
  if ((b.getTime() - a.getTime()) / DAY >= MAX_DAYS)
    a = new Date(b.getTime() - (MAX_DAYS - 1) * DAY);
  return { from: iso(a), to: iso(b) };
}

/** Điều kiện ngày cho Prisma: from ≤ date < to + 1 ngày. */
export function rangeBounds(r: DateRange) {
  return {
    gte: new Date(`${r.from}T00:00:00Z`),
    lt: new Date(new Date(`${r.to}T00:00:00Z`).getTime() + DAY),
  };
}

/** Mọi ngày trong khoảng (cho chuỗi biểu đồ, ngày không có dữ liệu = 0). */
export function daysIn(r: DateRange): string[] {
  const out: string[] = [];
  const { gte, lt } = rangeBounds(r);
  for (let t = gte.getTime(); t < lt.getTime(); t += DAY) out.push(iso(new Date(t)));
  return out;
}

/** Giữ khoảng ngày khi chuyển giữa các trang Analytics. */
export const rangeQuery = (r: DateRange) => `from=${r.from}&to=${r.to}`;
