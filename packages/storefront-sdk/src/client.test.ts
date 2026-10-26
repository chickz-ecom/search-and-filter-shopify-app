import { describe, expect, it, vi } from "vitest";
import { Client } from "./client";
import type { SearchAppContext } from "./types";

const ctx = (proxy: boolean) =>
  ({
    shop: "s.myshopify.com",
    publicKey: "pk",
    apiBase: proxy ? "/apps/search" : "https://api.example",
    proxy,
    locale: "en",
    country: "US",
  }) as SearchAppContext;

const ok = () => new Response("{}", { status: 200 });

describe("Client credentials", () => {
  // Store có mật khẩu (mọi dev store): thiếu cookie → Shopify 302 về /password, widget không có dữ liệu.
  it("sends same-origin cookies through the app proxy", async () => {
    const f = vi.fn<typeof fetch>(async () => ok());
    await new Client(ctx(true), f).get("config");
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: "same-origin" });
  });

  it("omits cookies when calling the search API directly", async () => {
    const f = vi.fn<typeof fetch>(async () => ok());
    await new Client(ctx(false), f).get("config");
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
  });
});
