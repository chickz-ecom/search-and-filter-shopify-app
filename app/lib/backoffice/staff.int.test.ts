import { afterAll, describe, expect, it } from "vitest";
import { testDb } from "../../../test/db";
import { postgresUp } from "../../../test/services";
import { createAgent, login } from "./auth.server";
import {
  changeOwnPassword,
  deleteRole,
  inviteAgent,
  resetPassword,
  saveRole,
  updateAgent,
} from "./staff.server";

const up = await postgresUp();

describe.skipIf(!up)("back-office staff (8.3)", () => {
  const tag = Date.now().toString(36);
  const ownerEmail = `owner-${tag}@example.com`;
  const newEmail = `support-${tag}@example.com`;
  const roleName = `Role ${tag}`;
  afterAll(async () => {
    await testDb().auditLog.deleteMany({ where: { agentEmail: ownerEmail } });
    await testDb().agent.deleteMany({ where: { email: { in: [ownerEmail, newEmail] } } });
    await testDb().agentRole.deleteMany({ where: { name: roleName } });
  });

  it("invites with a one-time password, resets it, and enforces the safety rules", async () => {
    const db = testDb();
    const { agent: owner, role: ownerRole } = await createAgent(db, {
      email: ownerEmail,
      name: "Owner",
      password: "owner-password-123",
      role: "Owner",
    });
    const actor = { id: owner.id, email: owner.email };
    const support = await db.agentRole.findUniqueOrThrow({ where: { name: "Support" } });

    const invited = await inviteAgent(db, actor, {
      email: newEmail,
      name: "Sam",
      roleId: support.id,
    });
    expect(invited).toMatchObject({ ok: true, email: newEmail });
    if (!invited.ok) return;
    expect((await login(db, newEmail, invited.password)).ok).toBe(true);
    expect(
      await inviteAgent(db, actor, { email: newEmail, name: "Sam", roleId: support.id }),
    ).toMatchObject({ ok: false });

    const reset = await resetPassword(
      db,
      actor,
      (await db.agent.findUniqueOrThrow({ where: { email: newEmail } })).id,
    );
    expect((await login(db, newEmail, invited.password)).ok).toBe(false);
    expect((await login(db, newEmail, reset.password)).ok).toBe(true);

    expect(await updateAgent(db, actor, owner.id, { active: false })).toEqual({
      ok: false,
      error: "You can't deactivate your own account",
    });
    expect(
      await saveRole(db, actor, ownerRole.id, { name: "Owner", permissions: [] }),
    ).toMatchObject({ ok: false });
    expect(await deleteRole(db, actor, support.id)).toMatchObject({ ok: false }); // còn agent giữ vai trò này

    expect(
      await saveRole(db, actor, null, { name: roleName, permissions: ["shops.view", "nope"] }),
    ).toMatchObject({ ok: false });
    expect(
      await saveRole(db, actor, null, { name: roleName, permissions: ["shops.view"] }),
    ).toEqual({ ok: true });

    expect(
      await changeOwnPassword(db, actor, "wrong", "next-password-456", "next-password-456"),
    ).toMatchObject({ ok: false });
    const changed = await changeOwnPassword(
      db,
      actor,
      "owner-password-123",
      "next-password-456",
      "next-password-456",
    );
    expect(changed).toMatchObject({
      ok: true,
      agent: { sessionVersion: owner.sessionVersion + 1 },
    });
  });
});
