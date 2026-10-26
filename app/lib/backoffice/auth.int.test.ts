import { afterAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { createAgent, hashPassword, login, verifyPassword } from "./auth.server";
import { can, PERMISSIONS } from "./permissions";

describe("passwords and permissions (pure)", () => {
  it("hashes with a random salt and verifies only the right password", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("checks permissions; owners get everything", () => {
    expect(can({ permissions: ["shops.view"] }, "shops.view")).toBe(true);
    expect(can({ permissions: ["shops.view"] }, "plans.manage")).toBe(false);
    expect(can({ permissions: ["*"] }, "agents.manage")).toBe(true);
    expect(PERMISSIONS).toContain("audit.view");
  });
});

const up = await postgresUp();

describe.skipIf(!up)("back-office login", () => {
  const email = `agent-${Date.now()}@example.com`;
  afterAll(async () => {
    await testDb().agent.deleteMany({ where: { email } });
  });

  it("logs in, locks after 5 bad passwords, and refuses disabled agents", async () => {
    const db = testDb();
    const { agent } = await createAgent(db, {
      email,
      name: "Ops",
      password: "a-long-password-1",
      role: "Owner",
    });
    const t0 = new Date("2026-10-26T10:00:00Z");
    expect(await login(db, email.toUpperCase(), "a-long-password-1", t0)).toMatchObject({
      ok: true,
      agent: { id: agent.id },
    });
    for (let i = 0; i < 5; i++) expect((await login(db, email, "nope", t0)).ok).toBe(false);
    // Đang khoá: đúng mật khẩu cũng bị từ chối, cùng một thông báo chung.
    expect(await login(db, email, "a-long-password-1", t0)).toEqual({
      ok: false,
      error: "invalid",
    });
    const later = new Date(t0.getTime() + 16 * 60_000);
    expect((await login(db, email, "a-long-password-1", later)).ok).toBe(true);
    await db.agent.update({ where: { id: agent.id }, data: { active: false } });
    expect((await login(db, email, "a-long-password-1", later)).ok).toBe(false);
    // Email không tồn tại → cùng thông báo (không lộ tài khoản nào có thật).
    expect(await login(db, "nobody@example.com", "x", later)).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});
