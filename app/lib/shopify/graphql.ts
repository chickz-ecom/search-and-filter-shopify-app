import { ADMIN_API_VERSION } from "./api-version";

// GraphQL executor biết throttle (task 1.1). Admin API dùng leaky bucket theo cost:
// theo dõi `extensions.cost.throttleStatus`, chờ khi bucket không đủ, retry khi THROTTLED / 429 / 5xx.
// VERIFY: shape `extensions.cost` + mã lỗi THROTTLED cho 2026-10 — docs/shopify-api/admin-graphql.md mục 14.

export type GraphqlError = {
  message: string;
  path?: (string | number)[];
  extensions?: { code?: string; [k: string]: unknown };
};

export type QueryCost = {
  requestedQueryCost?: number;
  actualQueryCost?: number | null;
  throttleStatus?: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
};

export type RawGraphqlResponse<T = unknown> = {
  data?: T | null;
  errors?: GraphqlError[];
  extensions?: { cost?: QueryCost; [k: string]: unknown };
};

export type GraphqlTransport = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<RawGraphqlResponse>;

export type Clock = { now(): number; sleep(ms: number): Promise<void> };

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    readonly errors: GraphqlError[] = [],
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShopifyGraphqlError";
  }
}

export type ExecutorOptions = {
  maxRetries?: number;
  /** Số query chạy song song tối đa cho shop này. */
  concurrency?: number;
  /** Cost mặc định khi chưa biết (query đơn giản ~ 10–50 điểm). */
  defaultCost?: number;
  baseBackoffMs?: number;
};

export type QueryOptions = {
  /** Ước lượng cost để chờ trước khi gửi (vd. nodes(ids: 50 sản phẩm)). */
  estimatedCost?: number;
};

type Bucket = { available: number; restoreRate: number; max: number; updatedAt: number };

function isRetryableStatus(status: number | undefined) {
  return status === undefined || status === 429 || status >= 500;
}

export class GraphqlExecutor {
  bucket: Bucket | null = null;
  private inFlight = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly opts: Required<ExecutorOptions>;

  constructor(
    private readonly transport: GraphqlTransport,
    private readonly clock: Clock = realClock,
    opts: ExecutorOptions = {},
  ) {
    this.opts = { maxRetries: 5, concurrency: 4, defaultCost: 50, baseBackoffMs: 500, ...opts };
  }

  static assertNoUserErrors(
    userErrors: { field?: string[] | null; message: string }[] | undefined,
    op: string,
  ) {
    if (userErrors?.length) {
      throw new ShopifyGraphqlError(`${op}: ${userErrors.map((e) => e.message).join("; ")}`);
    }
  }

  private availableNow(): number {
    if (!this.bucket) return Infinity;
    const elapsed = (this.clock.now() - this.bucket.updatedAt) / 1000;
    return Math.min(this.bucket.max, this.bucket.available + elapsed * this.bucket.restoreRate);
  }

  private async waitFor(cost: number) {
    if (!this.bucket) return;
    const cap = Math.min(cost, this.bucket.max);
    const have = this.availableNow();
    if (have < cap) {
      await this.clock.sleep(Math.ceil(((cap - have) / this.bucket.restoreRate) * 1000));
    }
    // Giữ chỗ để các query song song không cùng tiêu một phần bucket.
    this.bucket.available = Math.max(0, this.availableNow() - cap);
    this.bucket.updatedAt = this.clock.now();
  }

  private record(cost: QueryCost | undefined) {
    const t = cost?.throttleStatus;
    if (!t) return;
    this.bucket = {
      available: t.currentlyAvailable,
      restoreRate: t.restoreRate || 50,
      max: t.maximumAvailable,
      updatedAt: this.clock.now(),
    };
  }

  private async acquire() {
    if (this.inFlight < this.opts.concurrency) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((r) => this.waiters.push(r));
    this.inFlight++;
  }

  private release() {
    this.inFlight--;
    this.waiters.shift()?.();
  }

  async query<T>(
    query: string,
    variables?: Record<string, unknown>,
    opts: QueryOptions = {},
  ): Promise<T> {
    let cost = opts.estimatedCost ?? this.opts.defaultCost;
    for (let attempt = 0; ; attempt++) {
      await this.acquire();
      let res: RawGraphqlResponse;
      try {
        await this.waitFor(cost);
        res = await this.transport(query, variables);
      } catch (err) {
        this.release();
        const status = (err as { status?: number }).status;
        if (attempt < this.opts.maxRetries && isRetryableStatus(status)) {
          await this.clock.sleep(this.opts.baseBackoffMs * 2 ** attempt);
          continue;
        }
        throw err;
      }
      this.release();
      this.record(res.extensions?.cost);

      const throttled = res.errors?.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled) {
        if (attempt >= this.opts.maxRetries) {
          throw new ShopifyGraphqlError("Throttled: max retries reached", res.errors);
        }
        cost = res.extensions?.cost?.requestedQueryCost ?? cost;
        const have = this.availableNow();
        const rate = this.bucket?.restoreRate ?? 50;
        await this.clock.sleep(
          Math.max(this.opts.baseBackoffMs, Math.ceil(((cost - have) / rate) * 1000)),
        );
        // Đã chờ đủ cho cost này; không chờ thêm ở vòng sau.
        if (this.bucket) {
          this.bucket.available = Math.max(this.bucket.available, cost);
          this.bucket.updatedAt = this.clock.now();
        }
        continue;
      }
      if (res.errors?.length) {
        throw new ShopifyGraphqlError(res.errors.map((e) => e.message).join("; "), res.errors);
      }
      return res.data as T;
    }
  }
}

/** Adapter cho `admin.graphql` của @shopify/shopify-app-react-router (authenticate.admin / unauthenticated.admin). */
export function adminContextTransport(admin: {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}): GraphqlTransport {
  return async (query, variables) => {
    try {
      const res = await admin.graphql(query, { variables });
      return (await res.json()) as RawGraphqlResponse;
    } catch (err) {
      // GraphqlQueryError: body = { data, errors: { graphQLErrors, ... }, extensions }
      const body = (
        err as {
          body?: {
            data?: unknown;
            errors?: { graphQLErrors?: GraphqlError[] };
            extensions?: RawGraphqlResponse["extensions"];
          };
        }
      ).body;
      if (body?.errors?.graphQLErrors) {
        return { data: body.data, errors: body.errors.graphQLErrors, extensions: body.extensions };
      }
      const status = (err as { response?: { code?: number } }).response?.code;
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { status });
    }
  };
}

/** Transport fetch trực tiếp bằng access token (script benchmark, test với store thật). */
export function fetchTransport(
  shop: string,
  accessToken: string,
  opts: { apiVersion?: string; fetchImpl?: typeof fetch } = {},
): GraphqlTransport {
  const url = `https://${shop}/admin/api/${opts.apiVersion ?? ADMIN_API_VERSION}/graphql.json`;
  const f = opts.fetchImpl ?? fetch;
  return async (query, variables) => {
    const res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw Object.assign(new Error(`Admin API HTTP ${res.status}`), { status: res.status });
    }
    return (await res.json()) as RawGraphqlResponse;
  };
}

// Một executor cho mỗi shop trong process, để bucket được chia sẻ giữa các job.
const executors = new Map<string, GraphqlExecutor>();

export function executorFor(
  shop: string,
  makeTransport: () => GraphqlTransport,
  opts?: ExecutorOptions,
) {
  let ex = executors.get(shop);
  if (!ex) {
    ex = new GraphqlExecutor(makeTransport(), realClock, opts);
    executors.set(shop, ex);
  }
  return ex;
}
