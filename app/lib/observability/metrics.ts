// Metrics dạng Prometheus (task 6.1) — registry nhỏ, không phụ thuộc thư viện. Mỗi process (search-api, worker)
// có registry riêng, phơi ra /metrics (Bearer METRICS_TOKEN). Nhãn giữ cardinality thấp: KHÔNG gắn shop.

type Labels = Record<string, string>;
const key = (names: string[], l: Labels) => names.map((n) => l[n] ?? "").join("\u0000");
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const fmtLabels = (l: Labels) => {
  const parts = Object.entries(l).map(([k, v]) => `${k}="${esc(v)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
};
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6))));

interface Metric {
  render(): Promise<string[]> | string[];
}

class Counter implements Metric {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[],
  ) {}
  inc(labels: Labels = {}, by = 1) {
    const k = key(this.labelNames, labels);
    const cur = this.values.get(k) ?? { labels, value: 0 };
    cur.value += by;
    this.values.set(k, cur);
  }
  render() {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      ...[...this.values.values()].map((v) => `${this.name}${fmtLabels(v.labels)} ${num(v.value)}`),
    ];
  }
}

type Collect = () => Promise<{ labels: Labels; value: number }[]>;

class Gauge implements Metric {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[],
    private readonly collect?: Collect,
  ) {}
  set(labels: Labels, value: number) {
    this.values.set(key(this.labelNames, labels), { labels, value });
  }
  async render() {
    // Gauge có collect: đọc giá trị lúc scrape (độ sâu queue, độ trễ sync) — không cần timer.
    if (this.collect)
      for (const v of await this.collect().catch(() => [])) this.set(v.labels, v.value);
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      ...[...this.values.values()].map((v) => `${this.name}${fmtLabels(v.labels)} ${num(v.value)}`),
    ];
  }
}

class Histogram implements Metric {
  private series = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[],
    readonly buckets: number[],
  ) {}
  observe(labels: Labels, value: number) {
    const k = key(this.labelNames, labels);
    let s = this.series.get(k);
    if (!s)
      this.series.set(k, (s = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 }));
    this.buckets.forEach((b, i) => {
      if (value <= b) s!.counts[i]++;
    });
    s.sum += value;
    s.count++;
  }
  /** Ước lượng phân vị từ bucket (cận trên của bucket chứa phân vị) — cho báo cáo cục bộ/benchmark. */
  quantile(labels: Labels, q: number): number {
    const s = this.series.get(key(this.labelNames, labels));
    if (!s || !s.count) return 0;
    const target = q * s.count;
    const i = s.counts.findIndex((c) => c >= target);
    return i < 0 ? Infinity : this.buckets[i];
  }
  render() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      this.buckets.forEach((b, i) =>
        out.push(`${this.name}_bucket${fmtLabels({ ...s.labels, le: String(b) })} ${s.counts[i]}`),
      );
      out.push(`${this.name}_bucket${fmtLabels({ ...s.labels, le: "+Inf" })} ${s.count}`);
      out.push(`${this.name}_sum${fmtLabels(s.labels)} ${num(s.sum)}`);
      out.push(`${this.name}_count${fmtLabels(s.labels)} ${s.count}`);
    }
    return out;
  }
}

export class Registry {
  private metrics: Metric[] = [];
  counter(name: string, help: string, labelNames: string[] = []) {
    const m = new Counter(name, help, labelNames);
    this.metrics.push(m);
    return m;
  }
  gauge(name: string, help: string, labelNames: string[] = [], collect?: Collect) {
    const m = new Gauge(name, help, labelNames, collect);
    this.metrics.push(m);
    return m;
  }
  histogram(name: string, help: string, labelNames: string[], buckets: number[]) {
    const m = new Histogram(
      name,
      help,
      labelNames,
      [...buckets].sort((a, b) => a - b),
    );
    this.metrics.push(m);
    return m;
  }
  async render(): Promise<string> {
    const parts = await Promise.all(this.metrics.map((m) => m.render()));
    return parts.flat().join("\n") + "\n";
  }
  /** Chỉ metric không cần collect bất đồng bộ (test). */
  renderSync(): string {
    return (
      this.metrics
        .flatMap((m) => {
          const r = m.render();
          return Array.isArray(r) ? r : [];
        })
        .join("\n") + "\n"
    );
  }
}

/** Bucket độ trễ HTTP (giây): mục tiêu p95 search < 80 ms ở server (mục 6.1). */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.08, 0.1, 0.15, 0.25, 0.5, 1, 2.5];
/** Bucket độ trễ sync (giây): webhook → searchable mục tiêu < 60 s. */
export const SYNC_BUCKETS = [1, 2, 5, 10, 20, 30, 60, 120, 300, 900, 3600];
