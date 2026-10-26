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
    lastFullSyncAt: null,
    lastIncrementalAt: null,
    running: null,
    lastError: null,
  },
  jobs: [],
  hint: null,
  submitting: false,
  onSyncNow: () => undefined,
};

describe("SyncView", () => {
  it("shows x/y progress while indexing and disables Sync now", () => {
    const html = renderToStaticMarkup(<SyncView {...base} />);
    expect(html).toContain("Indexing: 5/10");
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
