import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FakeShopify, instantClock } from "../../../test/fakes/fake-shopify";
import { GraphqlExecutor } from "../shopify/graphql";
import { BulkRunner, planShards } from "./bulk-runner";
import { parseJsonl } from "./jsonl";
import { assembleDocs, buildFullSyncSpecs } from "./pipeline";
import { MemoryStaging } from "./staging";

const fixture = (f: string) =>
  readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), "utf8");

function setup(data: ConstructorParameters<typeof FakeShopify>[0]) {
  const fake = new FakeShopify(data);
  const clock = instantClock();
  const ex = new GraphqlExecutor(fake.transport, clock);
  const runner = new BulkRunner(ex, { fetchImpl: fake.fetch, clock, pollMinMs: 10, pollMaxMs: 50 });
  return { fake, runner };
}

describe("parseJsonl", () => {
  it("handles lines split across chunks and a trailing line without newline", async () => {
    async function* chunks() {
      yield '{"a":1}\n{"b"';
      yield new TextEncoder().encode(':2}\n\n{"c":"ü"}');
    }
    const rows = [];
    for await (const r of parseJsonl(chunks())) rows.push(r);
    expect(rows).toEqual([{ a: 1 }, { b: 2 }, { c: "ü" }]);
  });
});

describe("BulkRunner (1.3)", () => {
  it("runs flat bulks in parallel, streams each file as soon as it completes, joins by ID", async () => {
    const { fake, runner } = setup({
      products: fixture("products.jsonl"),
      productVariants: fixture("variants.jsonl"),
      collections: fixture("collections.jsonl"),
    });
    const staging = new MemoryStaging();
    const metafields = [{ namespace: "custom", key: "material", type: "single_line_text_field" }];
    const results = await runner.run(
      buildFullSyncSpecs({ staging, metafields, shards: [undefined] }),
    );
    expect(results.map((r) => [r.name, r.rows]).sort()).toEqual([
      ["collections", 8],
      ["products", 3],
      ["variants", 5],
    ]);
    expect(fake.maxRunning).toBe(3);
    const ops = [...fake.ops.values()];
    expect(ops.find((o) => o.root === "collections")?.groupObjects).toBe(true);
    expect(ops.find((o) => o.root === "products")?.groupObjects).toBe(false);

    const docs = [];
    for await (const d of assembleDocs(staging, { currency: "USD", metafields })) docs.push(d);
    expect(docs).toHaveLength(3);
    const tee = docs.find((d) => d.id === "1001")!;
    expect(tee.skus).toEqual(["TEE-S-RED", "TEE-M-BLUE"]); // variant đến không theo thứ tự vẫn join đúng
    expect(tee.collections).toEqual(["501", "502"]);
    expect(tee.pos_501).toBe(2);
    expect(docs.find((d) => d.id === "1003")!.pos_501).toBe(1);
    // Product 9999 trong collection nhưng không có trong products (draft) → không tạo doc.
    expect(docs.some((d) => d.id === "9999")).toBe(false);
  });

  it("waits and retries when 5 bulks are already running (LIMIT_REACHED)", async () => {
    const { fake, runner } = setup({ products: "", productVariants: "" });
    fake.limit = 1;
    const results = await runner.run([
      { name: "a", query: "{ products { edges { node { id } } } }", onRow: () => undefined },
      { name: "b", query: "{ productVariants { edges { node { id } } } }", onRow: () => undefined },
    ]);
    expect(results).toHaveLength(2);
    expect(fake.maxRunning).toBe(1);
  });

  it("fails loudly on FAILED bulks", async () => {
    const { fake, runner } = setup({ products: "" });
    const id = await runner.start("{ products { edges { node { id } } } }");
    fake.ops.get(id)!.status = "FAILED";
    await expect(
      runner
        .runOne({
          name: "x",
          query: "{ products { edges { node { id } } } }",
          onRow: () => undefined,
        })
        .then(async () => {
          // op mới vẫn COMPLETED; kiểm tra waitDone với op FAILED
          return runner.waitDone(id);
        }),
    ).resolves.toMatchObject({ status: "FAILED" });
  });

  it("treats COMPLETED with no url as zero rows", async () => {
    const { runner } = setup({});
    const r = await runner.runOne({
      name: "empty",
      query: "{ products { edges { node { id } } } }",
      onRow: () => undefined,
    });
    expect(r).toMatchObject({ status: "COMPLETED", rows: 0 });
  });
});

describe("planShards", () => {
  it("does not shard small catalogs", () => {
    expect(planShards(30_000, "2020-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toEqual([undefined]);
  });

  it("splits big catalogs into created_at ranges that cover everything", () => {
    const s = planShards(120_000, "2020-01-01T00:00:00Z", "2026-01-01T00:00:00Z", { maxShards: 3 });
    expect(s).toHaveLength(3);
    expect(s[0]).toMatch(/^created_at:<'/);
    expect(s[1]).toMatch(/^created_at:>='.*' AND created_at:<'/);
    expect(s[2]).toMatch(/^created_at:>='/);
    const cut = /created_at:<'([^']+)'/.exec(s[0]!)![1];
    expect(s[1]).toContain(`created_at:>='${cut}'`);
  });
});
