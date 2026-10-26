import type { Redis } from "ioredis";
import { redis as defaultRedis, rkey } from "../redis.server";

// Web Vitals admin (BFS: p75 trong 28 ngày, mỗi chỉ số ≥ 100 mẫu). Lưu mẫu thô theo ngày (giới hạn), tính p75 khi đọc.
const METRICS = new Set(["LCP", "CLS", "INP", "FCP", "TTFB"]);
const MAX_SAMPLES = 5000;
export const vitalsKey = (metric: string, day: string) => rkey("vitals", metric, day);

export async function recordAdminVitals(
  _shop: string,
  metrics: { name: string; value: number }[],
  r: Redis = defaultRedis(),
  now = new Date(),
) {
  const day = now.toISOString().slice(0, 10);
  const m = r.multi();
  for (const x of metrics) {
    if (!METRICS.has(x.name) || !Number.isFinite(x.value) || x.value < 0) continue;
    const k = vitalsKey(x.name, day);
    m.lpush(k, String(Math.round(x.value * 1000) / 1000));
    m.ltrim(k, 0, MAX_SAMPLES - 1);
    m.expire(k, 30 * 24 * 3600);
  }
  await m.exec();
}

export function p75(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.75) - 1)];
}

/** p75 của 28 ngày gần nhất cho từng chỉ số. */
export async function adminVitalsP75(r: Redis = defaultRedis(), now = new Date(), days = 28) {
  const out: Record<string, { p75: number | null; samples: number }> = {};
  for (const metric of METRICS) {
    const vals: number[] = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(now.getTime() - i * 24 * 3600_000).toISOString().slice(0, 10);
      vals.push(...(await r.lrange(vitalsKey(metric, day), 0, -1)).map(Number));
    }
    out[metric] = { p75: p75(vals), samples: vals.length };
  }
  return out;
}
