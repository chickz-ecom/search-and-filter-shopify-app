import type { GraphqlTransport, RawGraphqlResponse } from "../../app/lib/shopify/graphql";

// Giả lập Admin API cho bulk operation: start → RUNNING (pollsUntilDone lần) → COMPLETED + url.
// Nội dung JSONL chọn theo root field của query bulk. Dùng cho unit test, full-sync test, benchmark.

export type FakeBulkData = {
  products?: string | (() => AsyncIterable<string>);
  productVariants?: string | (() => AsyncIterable<string>);
  collections?: string | (() => AsyncIterable<string>);
  checksum?: string | (() => AsyncIterable<string>);
};

type Op = {
  id: string;
  root: keyof FakeBulkData;
  polls: number;
  status: string;
  groupObjects: boolean;
  query: string;
};

export class FakeShopify {
  ops = new Map<string, Op>();
  maxRunning = 0;
  limit = 5;
  pollsUntilDone = 1;
  /** Handler cho query thường (không phải bulk): trả data theo tên operation. */
  handlers: Record<string, (vars: Record<string, unknown>) => unknown> = {};
  calls: { query: string; variables?: Record<string, unknown> }[] = [];
  private seq = 0;

  constructor(public data: FakeBulkData) {}

  private running() {
    return [...this.ops.values()].filter((o) => o.status === "RUNNING").length;
  }

  private rootOf(query: string): keyof FakeBulkData {
    if (/^\s*\{\s*productVariants\(/.test(query)) return "productVariants";
    if (/^\s*\{\s*collections\(/.test(query)) return "collections";
    if (/edges\s*\{\s*node\s*\{\s*id\s+updatedAt\s*\}/.test(query)) return "checksum";
    return "products";
  }

  transport: GraphqlTransport = async (query, variables = {}): Promise<RawGraphqlResponse> => {
    this.calls.push({ query, variables });
    const cost = {
      requestedQueryCost: 10,
      throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 2000, restoreRate: 100 },
    };
    if (query.includes("bulkOperationRunQuery")) {
      if (this.running() >= this.limit) {
        return {
          data: {
            bulkOperationRunQuery: {
              bulkOperation: null,
              userErrors: [{ field: null, message: "limit", code: "LIMIT_REACHED" }],
            },
          },
          extensions: { cost },
        };
      }
      const id = `gid://shopify/BulkOperation/${++this.seq}`;
      const q = String(variables.query);
      this.ops.set(id, {
        id,
        root: this.rootOf(q),
        polls: 0,
        status: "RUNNING",
        groupObjects: Boolean(variables.groupObjects),
        query: q,
      });
      this.maxRunning = Math.max(this.maxRunning, this.running());
      return {
        data: {
          bulkOperationRunQuery: { bulkOperation: { id, status: "CREATED" }, userErrors: [] },
        },
        extensions: { cost },
      };
    }
    if (query.includes("bulkOperation(id:")) {
      const op = this.ops.get(String(variables.id));
      if (!op) return { data: { bulkOperation: null } };
      op.polls++;
      if (op.status === "RUNNING" && op.polls > this.pollsUntilDone) op.status = "COMPLETED";
      const has = this.data[op.root] !== undefined;
      return {
        data: {
          bulkOperation: {
            id: op.id,
            status: op.status,
            errorCode: null,
            objectCount: "0",
            url:
              op.status === "COMPLETED" && has
                ? `https://fake-bulk/${encodeURIComponent(op.id)}`
                : null,
            partialDataUrl: null,
          },
        },
        extensions: { cost },
      };
    }
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
    const h = this.handlers[name];
    if (!h) return { errors: [{ message: `FakeShopify: no handler for ${name}` }] };
    return { data: h(variables) as Record<string, unknown>, extensions: { cost } };
  };

  fetch: typeof fetch = async (input) => {
    const id = decodeURIComponent(String(input).split("/").pop()!);
    const op = this.ops.get(id);
    const src = op ? this.data[op.root] : undefined;
    if (src === undefined) return new Response("not found", { status: 404 });
    if (typeof src === "string") return new Response(src);
    const it = src()[Symbol.asyncIterator]();
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        const { done, value } = await it.next();
        if (done) ctrl.close();
        else ctrl.enqueue(enc.encode(value));
      },
    });
    return new Response(body);
  };
}

export const instantClock = () => {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => void (now += ms) };
};
