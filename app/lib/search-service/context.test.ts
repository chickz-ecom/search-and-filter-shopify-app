import { describe, expect, it, vi } from "vitest";
import type { SearchEngine } from "../search/engine";
import { clearContextMemory, getShopContext, type ContextDeps } from "./context.server";

describe("shop context loading under load (6.2)", () => {
  it("builds the context once for concurrent cold requests (single-flight)", async () => {
    clearContextMemory();
    const findUnique = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return null; // shop lạ → null, đủ để đếm số lần chạm DB
    });
    const deps = {
      db: { shop: { findUnique } },
      engine: {} as SearchEngine,
    } as unknown as ContextDeps;
    const results = await Promise.all(
      Array.from({ length: 200 }, () => getShopContext("cold.myshopify.com", deps)),
    );
    expect(results.every((r) => r === null)).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    // Xong rồi thì lần sau lại hỏi DB (không giữ kết quả null mãi).
    await getShopContext("cold.myshopify.com", deps);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
