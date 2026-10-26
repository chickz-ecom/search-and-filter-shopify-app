import { afterAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { EngineUnavailableError, type SearchEngine } from "../search/engine";
import { ensureShop } from "../shop/shop.server";
import type { GraphqlExecutor } from "../shopify/graphql";
import type { BulkRunner } from "./bulk-runner";
import { runFullSync } from "./full-sync.server";

// Hồi quy: engine tắt ngay lúc bắt đầu full sync → job phải là FAILED (không kẹt RUNNING mãi), shop ERROR,
// lỗi được ném lại để BullMQ thử lại.
const up = await postgresUp();

describe.skipIf(!up)("full sync when the engine is down at start", () => {
  const domain = `down-${Date.now()}.myshopify.com`;
  afterAll(() => testDb().shop.deleteMany({ where: { domain } }));

  it("marks the job FAILED and the shop ERROR, and rethrows for a retry", async () => {
    const { shop } = await ensureShop(testDb(), domain);
    const engine = {
      getAlias: async () => {
        throw new EngineUnavailableError(
          "Typesense unavailable during getAlias",
          new Error("ECONNREFUSED"),
        );
      },
    } as unknown as SearchEngine;
    await expect(
      runFullSync(
        shop.id,
        {
          db: testDb(),
          engine,
          ex: {} as GraphqlExecutor,
          runner: {} as BulkRunner,
        },
        { reason: "install" },
      ),
    ).rejects.toThrow(/unavailable/);
    const jobs = await testDb().syncJob.findMany({ where: { shopId: shop.id } });
    expect(jobs.map((j) => [j.status, j.error])).toEqual([
      ["FAILED", "Typesense unavailable during getAlias"],
    ]);
    expect((await testDb().shop.findUniqueOrThrow({ where: { id: shop.id } })).syncState).toBe(
      "ERROR",
    );
  });
});
