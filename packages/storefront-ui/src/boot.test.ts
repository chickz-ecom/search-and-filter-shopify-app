// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// App embed đặt stub { ready() } trước khi SDK thật tải. Widget nạp trước SDK phải chờ searchapp:ready,
// không được coi stub là SDK (lỗi thật trên dev store: widget không bao giờ đăng ký, block đứng yên).
const stub = () => ({ ready: () => new Promise(() => {}) });

function fakeSdk() {
  return {
    version: "1.1.0",
    registerWidget: vi.fn(),
    getConfig: () => new Promise(() => {}),
    on: vi.fn(),
  };
}

afterEach(() => {
  delete (window as { SearchApp?: unknown }).SearchApp;
  vi.resetModules();
});

describe("widget boot order", () => {
  it("results: waits for the real SDK when only the embed stub exists", async () => {
    (window as { SearchApp?: unknown }).SearchApp = stub();
    await import("./results");
    const sdk = fakeSdk();
    (window as { SearchApp?: unknown }).SearchApp = sdk;
    document.dispatchEvent(new CustomEvent("searchapp:ready", { detail: sdk }));
    expect(sdk.registerWidget).toHaveBeenCalledWith("search-page", expect.any(Function));
  });

  it("results: registers immediately when the real SDK is already there", async () => {
    const sdk = fakeSdk();
    (window as { SearchApp?: unknown }).SearchApp = sdk;
    await import("./results");
    expect(sdk.registerWidget).toHaveBeenCalledWith("search-page", expect.any(Function));
  });

  it("instant: waits for the real SDK instead of attaching with the embed stub", async () => {
    document.body.innerHTML = '<form action="/search"><input name="q"></form>';
    (window as { SearchApp?: unknown }).SearchApp = stub();
    await import("./instant");
    const input = document.querySelector("input")!;
    expect(input.dataset.saInstant).toBeUndefined();
    const sdk = { ...fakeSdk(), context: { cssUrl: "" } };
    (window as { SearchApp?: unknown }).SearchApp = sdk;
    document.dispatchEvent(new CustomEvent("searchapp:ready", { detail: sdk }));
    expect(input.dataset.saInstant).toBe("1");
  });
});
