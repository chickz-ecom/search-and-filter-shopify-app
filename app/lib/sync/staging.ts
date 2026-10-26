import type { CollectionMembership, ProductNode, VariantNode } from "./mapper";

// Staging cho full sync (mục 5.1 bước 4): mỗi bulk đổ vào đây ngay khi xong, join theo productId
// (không dựa thứ tự dòng).
// - MemoryStaging: nhanh nhất, RAM tăng tuyến tính (~4 KB/sản phẩm đo ở benchmark 1.3) → catalog nhỏ.
// - PgStaging (bảng UNLOGGED): RAM worker cố định bất kể kích thước catalog → catalog lớn.

export type StagedEntry = {
  product: ProductNode;
  variants: VariantNode[];
  collections: CollectionMembership[];
};

export interface Staging {
  putProduct(p: ProductNode): void | Promise<void>;
  addVariant(v: VariantNode): void | Promise<void>;
  addCollection(productGid: string, c: CollectionMembership): void | Promise<void>;
  /** Ghi phần còn trong buffer. */
  flush(): Promise<void>;
  count(): Promise<number>;
  entries(): AsyncIterable<StagedEntry>;
  clear(): Promise<void>;
}

const SEP = "\u0001";

function encodeCollection(c: CollectionMembership) {
  return `${c.id}|${c.manual ? 1 : 0}|${c.position ?? ""}`;
}

function decodeCollection(
  s: string,
  info: Map<string, { handle: string; title: string }>,
): CollectionMembership {
  const [cid, manual, pos] = s.split("|");
  const i = info.get(cid) ?? { handle: "", title: "" };
  return {
    id: cid,
    handle: i.handle,
    title: i.title,
    manual: manual === "1",
    ...(pos ? { position: Number(pos) } : {}),
  };
}

function stripProduct(v: VariantNode): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { product, ...rest } = v;
  return JSON.stringify(rest);
}

export class MemoryStaging implements Staging {
  private products = new Map<string, string>();
  private variants = new Map<string, string>();
  private collections = new Map<string, string>();
  private collectionInfo = new Map<string, { handle: string; title: string }>();

  putProduct(p: ProductNode) {
    this.products.set(p.id, JSON.stringify(p));
  }

  addVariant(v: VariantNode) {
    const pid = v.product.id;
    const s = stripProduct(v);
    const prev = this.variants.get(pid);
    this.variants.set(pid, prev === undefined ? s : prev + SEP + s);
  }

  addCollection(productGid: string, c: CollectionMembership) {
    if (!this.collectionInfo.has(c.id))
      this.collectionInfo.set(c.id, { handle: c.handle, title: c.title });
    const s = encodeCollection(c);
    const prev = this.collections.get(productGid);
    this.collections.set(productGid, prev === undefined ? s : prev + SEP + s);
  }

  async flush() {}

  async count() {
    return this.products.size;
  }

  async *entries(): AsyncIterable<StagedEntry> {
    for (const [id, raw] of this.products) {
      const vRaw = this.variants.get(id);
      const cRaw = this.collections.get(id);
      yield {
        product: JSON.parse(raw) as ProductNode,
        variants: vRaw ? vRaw.split(SEP).map((s) => ({ ...JSON.parse(s), product: { id } })) : [],
        collections: cRaw
          ? cRaw.split(SEP).map((s) => decodeCollection(s, this.collectionInfo))
          : [],
      };
    }
  }

  async clear() {
    this.products.clear();
    this.variants.clear();
    this.collections.clear();
    this.collectionInfo.clear();
  }
}

/** Tối thiểu cần từ Prisma (`prisma.$executeRawUnsafe` / `$queryRawUnsafe`) — để test thay được. */
export type SqlClient = {
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
};

let tablesReady: Promise<void> | undefined;

/**
 * Bảng UNLOGGED dùng chung, phân theo job_id. Tạo lúc chạy (không nằm trong schema.prisma để
 * `prisma migrate` không đòi xoá). UNLOGGED: không ghi WAL → ghi nhanh, mất khi crash (chấp nhận được: job chạy lại).
 */
export function ensureStagingTables(db: SqlClient): Promise<void> {
  tablesReady ??= (async () => {
    await db.$executeRawUnsafe(
      `CREATE UNLOGGED TABLE IF NOT EXISTS sync_stage_products (job_id text NOT NULL, pid text NOT NULL, data text NOT NULL, PRIMARY KEY (job_id, pid))`,
    );
    await db.$executeRawUnsafe(
      `CREATE UNLOGGED TABLE IF NOT EXISTS sync_stage_variants (job_id text NOT NULL, pid text NOT NULL, data text NOT NULL)`,
    );
    await db.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS sync_stage_variants_idx ON sync_stage_variants (job_id, pid)`,
    );
    await db.$executeRawUnsafe(
      `CREATE UNLOGGED TABLE IF NOT EXISTS sync_stage_collections (job_id text NOT NULL, pid text NOT NULL, data text NOT NULL, handle text NOT NULL, title text NOT NULL)`,
    );
    await db.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS sync_stage_collections_idx ON sync_stage_collections (job_id, pid)`,
    );
  })().catch((err) => {
    tablesReady = undefined;
    throw err;
  });
  return tablesReady;
}

export class PgStaging implements Staging {
  private p: [string, string][] = [];
  private v: [string, string][] = [];
  private c: [string, string, string, string][] = [];
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: SqlClient,
    private readonly jobId: string,
    private readonly opts: { batch?: number; pageSize?: number } = {},
  ) {}

  private get batch() {
    return this.opts.batch ?? 2000;
  }

  /** Ghi nối tiếp (một lô một lúc) để giữ RAM thấp và tránh tranh chấp. */
  private enqueue(fn: () => Promise<unknown>): Promise<void> {
    this.pending = this.pending.then(async () => {
      await ensureStagingTables(this.db);
      await fn();
    });
    return this.pending;
  }

  putProduct(p: ProductNode) {
    this.p.push([p.id, JSON.stringify(p)]);
    if (this.p.length >= this.batch) return this.flushProducts();
  }

  addVariant(v: VariantNode) {
    this.v.push([v.product.id, stripProduct(v)]);
    if (this.v.length >= this.batch) return this.flushVariants();
  }

  addCollection(productGid: string, c: CollectionMembership) {
    this.c.push([productGid, encodeCollection(c), c.handle, c.title]);
    if (this.c.length >= this.batch) return this.flushCollections();
  }

  private flushProducts() {
    const rows = this.p.splice(0);
    if (!rows.length) return this.pending;
    return this.enqueue(() =>
      this.db.$executeRawUnsafe(
        `INSERT INTO sync_stage_products (job_id, pid, data) SELECT $1, * FROM unnest($2::text[], $3::text[])
         ON CONFLICT (job_id, pid) DO UPDATE SET data = EXCLUDED.data`,
        this.jobId,
        rows.map((r) => r[0]),
        rows.map((r) => r[1]),
      ),
    );
  }

  private flushVariants() {
    const rows = this.v.splice(0);
    if (!rows.length) return this.pending;
    return this.enqueue(() =>
      this.db.$executeRawUnsafe(
        `INSERT INTO sync_stage_variants (job_id, pid, data) SELECT $1, * FROM unnest($2::text[], $3::text[])`,
        this.jobId,
        rows.map((r) => r[0]),
        rows.map((r) => r[1]),
      ),
    );
  }

  private flushCollections() {
    const rows = this.c.splice(0);
    if (!rows.length) return this.pending;
    return this.enqueue(() =>
      this.db.$executeRawUnsafe(
        `INSERT INTO sync_stage_collections (job_id, pid, data, handle, title) SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])`,
        this.jobId,
        rows.map((r) => r[0]),
        rows.map((r) => r[1]),
        rows.map((r) => r[2]),
        rows.map((r) => r[3]),
      ),
    );
  }

  async flush() {
    void this.flushProducts();
    void this.flushVariants();
    void this.flushCollections();
    await this.pending;
  }

  async count() {
    await this.flush();
    const r = await this.db.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT count(*) AS n FROM sync_stage_products WHERE job_id = $1`,
      this.jobId,
    );
    return Number(r[0]?.n ?? 0);
  }

  async *entries(): AsyncIterable<StagedEntry> {
    await this.flush();
    const pageSize = this.opts.pageSize ?? 1000;
    let after = "";
    for (;;) {
      const rows = await this.db.$queryRawUnsafe<
        {
          pid: string;
          data: string;
          variants: string[] | null;
          collections: string[] | null;
          chandles: string[] | null;
          ctitles: string[] | null;
        }[]
      >(
        `SELECT p.pid, p.data,
           (SELECT array_agg(v.data) FROM sync_stage_variants v WHERE v.job_id = p.job_id AND v.pid = p.pid) AS variants,
           c.collections, c.chandles, c.ctitles
         FROM sync_stage_products p
         LEFT JOIN LATERAL (
           SELECT array_agg(data) AS collections, array_agg(handle) AS chandles, array_agg(title) AS ctitles
           FROM sync_stage_collections c WHERE c.job_id = p.job_id AND c.pid = p.pid
         ) c ON true
         WHERE p.job_id = $1 AND p.pid > $2
         ORDER BY p.pid
         LIMIT $3`,
        this.jobId,
        after,
        pageSize,
      );
      if (!rows.length) return;
      for (const r of rows) {
        const info = new Map<string, { handle: string; title: string }>();
        const cols = (r.collections ?? []).map((s, i) => {
          info.set(s.split("|")[0], { handle: r.chandles?.[i] ?? "", title: r.ctitles?.[i] ?? "" });
          return s;
        });
        yield {
          product: JSON.parse(r.data) as ProductNode,
          variants: (r.variants ?? []).map((s) => ({ ...JSON.parse(s), product: { id: r.pid } })),
          collections: cols.map((s) => decodeCollection(s, info)),
        };
      }
      after = rows[rows.length - 1].pid;
      if (rows.length < pageSize) return;
    }
  }

  async clear() {
    this.p = [];
    this.v = [];
    this.c = [];
    await ensureStagingTables(this.db);
    for (const t of ["sync_stage_products", "sync_stage_variants", "sync_stage_collections"]) {
      await this.db.$executeRawUnsafe(`DELETE FROM ${t} WHERE job_id = $1`, this.jobId);
    }
  }
}

/** Ngưỡng chọn staging: dưới ngưỡng dùng RAM (nhanh), trên ngưỡng dùng Postgres (RAM cố định). */
export const MEMORY_STAGING_MAX_PRODUCTS = 20_000;
