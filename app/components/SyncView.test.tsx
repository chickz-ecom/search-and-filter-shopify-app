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
    steps: null,
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
  it("says the percent is for the whole sync and lists each step with its own count", () => {
    const html = renderToStaticMarkup(
      <SyncView
        {...base}
        status={{
          ...base.status,
          phase: "fetch",
          productCount: 34649,
          percent: 22,
          running: { id: "j", type: "FULL", startedAt: "2026-10-26T10:00:00Z" },
          steps: [
            { key: "products", state: "active", n: 27649, total: 34649 },
            { key: "variants", state: "active", n: 61200 },
            { key: "collections", state: "done" },
            { key: "save", state: "waiting" },
            { key: "live", state: "waiting" },
          ],
        }}
      />,
    );
    expect(html).toContain("Downloading data from Shopify · 22% overall");
    expect(html).toMatch(/<s-progress[^>]*value="22"/);
    expect(html).toContain("27,649/34,649");
    expect(html).toContain("61,200 variants");
    expect(html).toContain("Save to the search index");
    expect(html).toMatch(/Collections<\/s-text>.*?Done/s);
    const queued = renderToStaticMarkup(
      <SyncView {...base} status={{ ...base.status, state: "QUEUED", percent: 0 }} />,
    );
    expect(queued).toContain("waiting for the sync worker");
  });

  it("reindex names its own phase (no Shopify download)", () => {
    const html = renderToStaticMarkup(
      <SyncView
        {...base}
        status={{
          ...base.status,
          phase: "index",
          percent: 50,
          running: { id: "j", type: "REINDEX", startedAt: "2026-10-26T10:00:00Z" },
          steps: [
            { key: "rebuild", state: "active", n: 5, total: 10 },
            { key: "live", state: "waiting" },
          ],
        }}
      />,
    );
    expect(html).toContain("Rebuilding the search index · 50% overall");
    expect(html).not.toContain("Downloading");
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

  it("shows the overall percent while running and disables Sync now", () => {
    const html = renderToStaticMarkup(<SyncView {...base} />);
    expect(html).toContain("Preparing · 50% overall");
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
