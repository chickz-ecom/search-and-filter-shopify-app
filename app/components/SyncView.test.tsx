import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { syncErrorHint } from "../lib/sync/errors";
import { SyncView, type SyncViewProps } from "./SyncView";

const base: SyncViewProps = {
  locale: "en",
  status: {
    state: "RUNNING",
    productCount: 10,
    indexedCount: 5,
    percent: 50,
    phase: null,
    fetchedProducts: null,
    lastFullSyncAt: null,
    lastIncrementalAt: null,
    running: null,
    lastError: null,
  },
  jobs: [],
  hint: null,
  submitting: false,
  onSyncNow: () => undefined,
  onReindex: () => undefined,
};

describe("SyncView", () => {
  it("names the running phase: downloading from Shopify as x/y products", () => {
    const html = renderToStaticMarkup(
      <SyncView
        {...base}
        status={{
          ...base.status,
          phase: "fetch",
          fetchedProducts: 1240,
          productCount: 10500,
          percent: 27,
        }}
      />,
    );
    expect(html).toContain("Downloading from Shopify: 1,240/10,500 products · 27%");
    expect(html).toMatch(/<s-progress[^>]*value="27"/);
    const queued = renderToStaticMarkup(
      <SyncView {...base} status={{ ...base.status, state: "QUEUED", percent: 0 }} />,
    );
    expect(queued).toContain("waiting for the sync worker");
  });

  it("offers Sync from Shopify and a separate Reindex, both disabled while a sync runs", () => {
    const busy = renderToStaticMarkup(<SyncView {...base} />);
    expect(busy).toContain("Sync from Shopify");
    expect(busy).toMatch(/<s-button[^>]*slot="secondary-actions"[^>]*disabled[^>]*>Reindex</);
    const idle = renderToStaticMarkup(
      <SyncView {...base} status={{ ...base.status, state: "IDLE" }} />,
    );
    expect(idle).toMatch(/<s-button[^>]*slot="secondary-actions"(?![^>]*disabled)[^>]*>Reindex</);
    expect(idle).toContain("does not pick up new products");
  });

  it("shows x/y progress while indexing and disables Sync now", () => {
    const html = renderToStaticMarkup(<SyncView {...base} />);
    expect(html).toContain("Building the search index: 5/10 products · 50%");
    expect(html).toContain("<s-progress");
    expect(html).toMatch(/<s-button[^>]*disabled/);
  });

  it("shows the error with a fix in Vietnamese", () => {
    const html = renderToStaticMarkup(
      <SyncView
        {...base}
        locale="vi"
        status={{
          ...base.status,
          state: "ERROR",
          lastError: { message: "Count check failed: x", at: "2026-10-26T00:00:00Z" },
        }}
        hint={syncErrorHint("Count check failed: x")}
        jobs={[
          {
            id: "1",
            type: "FULL",
            status: "FAILED",
            startedAt: "2026-10-26T00:00:00Z",
            durationMs: 90_000,
            imported: 0,
            error: "x",
          },
        ]}
      />,
    );
    expect(html).toContain("Lượt đồng bộ gần nhất bị lỗi");
    expect(html).toContain("Một số sản phẩm chưa index được");
    expect(html).toContain("Đồng bộ toàn bộ");
    expect(html).toContain("2m");
  });

  it("maps errors to fixes", () => {
    expect(syncErrorHint("Throttled: max retries")).toBe("sync.fix.throttled");
    expect(syncErrorHint("Typesense unavailable during import")).toBe("sync.fix.engine");
    expect(syncErrorHint("weird")).toBe("sync.fix.generic");
  });
});
