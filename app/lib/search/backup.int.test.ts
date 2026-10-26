import { describe, expect, it } from "vitest";
import { typesenseUp } from "../../../test/services";
import { snapshotEngine } from "./backup.server";
import { TypesenseEngine } from "./typesense-engine";

const up = await typesenseUp();
const engine = new TypesenseEngine({
  host: "localhost",
  port: 8108,
  protocol: "http",
  apiKey: process.env.TYPESENSE_API_KEY ?? "dev-typesense-key",
});

describe("Typesense backup (6.2)", () => {
  it("is a no-op until a snapshot dir is configured", async () => {
    expect(await snapshotEngine(engine, "")).toEqual({ skipped: "TYPESENSE_SNAPSHOT_DIR not set" });
  });

  it.skipIf(!up)("writes a dated snapshot on the engine host", async () => {
    // Thư mục trong container Typesense dev (docker volume), tên theo ngày cố định để không rác nhiều thư mục.
    const r = await snapshotEngine(
      engine,
      "/tmp/searchapp-test-snapshots/",
      new Date("2030-01-02T03:00:00Z"),
    );
    expect(r).toEqual({ path: "/tmp/searchapp-test-snapshots/2030-01-02" });
  });
});
