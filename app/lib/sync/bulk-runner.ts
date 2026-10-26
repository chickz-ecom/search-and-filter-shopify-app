import { GraphqlExecutor, realClock, ShopifyGraphqlError, type Clock } from "../shopify/graphql";
import { parseJsonl } from "./jsonl";
import { BULK_CANCEL_MUTATION, BULK_RUN_MUTATION, BULK_STATUS_QUERY } from "./queries";

// Bulk runner (task 1.3): chạy nhiều bulk phẳng song song (≤ 5 query/shop từ 2026-01),
// mỗi bulk xong thì tải + stream-parse ngay, không đợi bulk khác (mục 5.1 bước 4).

export type BulkStatus =
  "CREATED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELING" | "CANCELED" | "EXPIRED";

export type BulkOperationInfo = {
  id: string;
  status: BulkStatus;
  errorCode: string | null;
  objectCount: string | number | null;
  url: string | null;
  partialDataUrl: string | null;
};

export type BulkSpec<Row = Record<string, unknown>> = {
  name: string;
  query: string;
  /** true chỉ khi cần thứ tự connection con (collections → products). */
  groupObjects?: boolean;
  onRow: (row: Row) => void | Promise<void>;
  /** Mỗi lần poll trạng thái (objectCount tăng dần) — cho thanh tiến độ trang Sync. */
  onStatus?: (info: BulkOperationInfo) => void;
};

export type BulkResult = {
  name: string;
  id: string;
  status: BulkStatus;
  rows: number;
  /** Thời gian Shopify chạy bulk (start → COMPLETED). */
  waitMs: number;
  /** Thời gian tải + parse + onRow. */
  processMs: number;
};

/** Tín hiệu từ webhook bulk_operations/finish (Redis pub/sub). Resolve khi có tin hoặc hết timeout. */
export interface BulkNotifier {
  wait(bulkId: string, timeoutMs: number): Promise<void>;
}

export type BulkRunnerDeps = {
  fetchImpl?: typeof fetch;
  clock?: Clock;
  notifier?: BulkNotifier;
  /** Chu kỳ poll dự phòng: bắt đầu nhỏ, tăng dần tới max. */
  pollMinMs?: number;
  pollMaxMs?: number;
  maxConcurrent?: number;
  /** Timeout tổng cho một bulk (Shopify cho tối đa 10 ngày; ta dừng sớm hơn nhiều). */
  timeoutMs?: number;
};

const TERMINAL: ReadonlySet<BulkStatus> = new Set(["COMPLETED", "FAILED", "CANCELED", "EXPIRED"]);

export class BulkError extends Error {
  constructor(
    message: string,
    readonly info?: BulkOperationInfo,
  ) {
    super(message);
    this.name = "BulkError";
  }
}

export class BulkRunner {
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly d: Required<Omit<BulkRunnerDeps, "fetchImpl" | "clock" | "notifier">>;

  constructor(
    private readonly ex: GraphqlExecutor,
    private readonly deps: BulkRunnerDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.clock = deps.clock ?? realClock;
    this.d = {
      pollMinMs: deps.pollMinMs ?? 1000,
      pollMaxMs: deps.pollMaxMs ?? 10_000,
      maxConcurrent: deps.maxConcurrent ?? 5,
      timeoutMs: deps.timeoutMs ?? 2 * 60 * 60 * 1000,
    };
  }

  async start(query: string, groupObjects = false): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const data = await this.ex.query<{
        bulkOperationRunQuery: {
          bulkOperation: { id: string } | null;
          userErrors: { field: string[] | null; message: string; code: string | null }[];
        };
      }>(BULK_RUN_MUTATION, { query, groupObjects });
      const r = data.bulkOperationRunQuery;
      const limit = r.userErrors.find((e) => e.code === "LIMIT_REACHED");
      if (limit && attempt < 30) {
        // Đã đủ 5 bulk đang chạy (có thể của job khác) → chờ rồi thử lại.
        await this.clock.sleep(this.d.pollMaxMs);
        continue;
      }
      GraphqlExecutor.assertNoUserErrors(r.userErrors, "bulkOperationRunQuery");
      if (!r.bulkOperation)
        throw new ShopifyGraphqlError("bulkOperationRunQuery returned no operation");
      return r.bulkOperation.id;
    }
  }

  async status(id: string): Promise<BulkOperationInfo> {
    const data = await this.ex.query<{ bulkOperation: BulkOperationInfo | null }>(
      BULK_STATUS_QUERY,
      { id },
    );
    if (!data.bulkOperation) throw new BulkError(`Bulk operation ${id} not found`);
    return data.bulkOperation;
  }

  async cancel(id: string): Promise<void> {
    await this.ex.query(BULK_CANCEL_MUTATION, { id }).catch(() => undefined);
  }

  async waitDone(
    id: string,
    onStatus?: (info: BulkOperationInfo) => void,
  ): Promise<BulkOperationInfo> {
    const started = this.clock.now();
    let interval = this.d.pollMinMs;
    for (;;) {
      const info = await this.status(id);
      onStatus?.(info);
      if (TERMINAL.has(info.status)) return info;
      if (this.clock.now() - started > this.d.timeoutMs) {
        await this.cancel(id);
        throw new BulkError(`Bulk operation ${id} timed out`, info);
      }
      if (this.deps.notifier) await this.deps.notifier.wait(id, interval);
      else await this.clock.sleep(interval);
      interval = Math.min(this.d.pollMaxMs, Math.round(interval * 1.5));
    }
  }

  async *download<Row>(url: string): AsyncIterable<Row> {
    const res = await this.fetchImpl(url);
    if (!res.ok || !res.body) throw new BulkError(`Bulk download failed: HTTP ${res.status}`);
    yield* parseJsonl<Row>(res.body);
  }

  async runOne<Row>(spec: BulkSpec<Row>): Promise<BulkResult> {
    const t0 = this.clock.now();
    const id = await this.start(spec.query, spec.groupObjects ?? false);
    const info = await this.waitDone(id, spec.onStatus);
    const t1 = this.clock.now();
    if (info.status !== "COMPLETED") {
      throw new BulkError(
        `Bulk ${spec.name} ${info.status}${info.errorCode ? ` (${info.errorCode})` : ""}`,
        info,
      );
    }
    let rows = 0;
    // url null + COMPLETED = không có dòng nào.
    if (info.url) {
      for await (const row of this.download<Row>(info.url)) {
        await spec.onRow(row);
        rows++;
      }
    }
    return {
      name: spec.name,
      id,
      status: info.status,
      rows,
      waitMs: t1 - t0,
      processMs: this.clock.now() - t1,
    };
  }

  /** Chạy song song (≤ maxConcurrent). Lỗi một bulk → huỷ phần còn lại và ném lỗi. */
  async run(specs: BulkSpec<never>[]): Promise<BulkResult[]> {
    const results: BulkResult[] = [];
    let next = 0;
    let failed: unknown;
    const worker = async () => {
      while (next < specs.length && !failed) {
        const spec = specs[next++];
        try {
          results.push(await this.runOne(spec));
        } catch (err) {
          failed ??= err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.d.maxConcurrent, specs.length) }, worker));
    if (failed) throw failed;
    return results;
  }
}

/** Chia shard theo created_at khi catalog lớn (mục 5.1 bước 2d/2e). */
export function planShards(
  count: number,
  oldest: string | null | undefined,
  newest: string | null | undefined,
  opts: { threshold?: number; maxShards?: number } = {},
): (string | undefined)[] {
  const threshold = opts.threshold ?? 50_000;
  const maxShards = opts.maxShards ?? 2;
  if (count <= threshold || !oldest || !newest) return [undefined];
  const n = Math.min(maxShards, Math.ceil(count / threshold));
  const a = Date.parse(oldest);
  const b = Date.parse(newest) + 1000;
  if (!(b > a) || n < 2) return [undefined];
  const step = (b - a) / n;
  const cuts = Array.from({ length: n - 1 }, (_, i) =>
    new Date(Math.round(a + step * (i + 1))).toISOString(),
  );
  return Array.from({ length: n }, (_, i) => {
    const parts: string[] = [];
    if (i > 0) parts.push(`created_at:>='${cuts[i - 1]}'`);
    if (i < n - 1) parts.push(`created_at:<'${cuts[i]}'`);
    return parts.join(" AND ");
  });
}

export const CATALOG_STATS_QUERY = `query CatalogStats($query: String!) {
  productsCount(query: $query, limit: null) { count precision }
  oldest: products(first: 1, sortKey: CREATED_AT, query: $query) { nodes { createdAt } }
  newest: products(first: 1, sortKey: CREATED_AT, reverse: true, query: $query) { nodes { createdAt } }
}`;

export type CatalogStats = { count: number; oldest: string | null; newest: string | null };

export async function catalogStats(ex: GraphqlExecutor, query: string): Promise<CatalogStats> {
  const d = await ex.query<{
    productsCount: { count: number } | null;
    oldest: { nodes: { createdAt: string }[] };
    newest: { nodes: { createdAt: string }[] };
  }>(CATALOG_STATS_QUERY, { query });
  return {
    count: d.productsCount?.count ?? 0,
    oldest: d.oldest.nodes[0]?.createdAt ?? null,
    newest: d.newest.nodes[0]?.createdAt ?? null,
  };
}
