import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db } from "../shop/shop.server";
import { audit } from "./audit.server";
import { createAgent, hashPassword, MIN_PASSWORD, verifyPassword } from "./auth.server";
import { PERMISSIONS } from "./permissions";

// Back-office (8.3): nhân viên, vai trò, mật khẩu, audit log.
// An toàn: không tự tắt mình, luôn còn ít nhất một Owner đang hoạt động; mật khẩu tạo/reset chỉ trả về một lần;
// tắt tài khoản / reset / đổi mật khẩu → tăng sessionVersion (mọi phiên cũ hết hiệu lực).

type Actor = { id: string; email: string };
const newPassword = () => randomBytes(18).toString("base64url");

export async function listStaff(db: Db) {
  const [agents, roles] = await Promise.all([
    db.agent.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        lastLoginAt: true,
        lockedUntil: true,
        role: { select: { id: true, name: true } },
      },
    }),
    db.agentRole.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { agents: true } } },
    }),
  ]);
  return { agents, roles };
}

const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  name: z.string().trim().min(1, "Enter a name").max(80),
  roleId: z.string().min(1, "Choose a role"),
});

export async function inviteAgent(db: Db, actor: Actor, raw: unknown) {
  const p = InviteInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: p.error.issues[0].message };
  if (await db.agent.findUnique({ where: { email: p.data.email } }))
    return { ok: false as const, error: "An agent with this email already exists" };
  const role = await db.agentRole.findUnique({ where: { id: p.data.roleId } });
  if (!role) return { ok: false as const, error: "Choose a role" };
  const password = newPassword();
  const { agent } = await createAgent(db, {
    email: p.data.email,
    name: p.data.name,
    password,
    role: role.name,
  });
  await audit(
    db,
    actor,
    "agent.create",
    { type: "agent", id: agent.id },
    { email: agent.email, role: role.name },
  );
  return { ok: true as const, email: agent.email, password };
}

/** Còn Owner nào khác đang hoạt động ngoài `exceptId`? */
async function anotherActiveOwner(db: Db, exceptId: string) {
  return (
    (await db.agent.count({
      where: { id: { not: exceptId }, active: true, role: { permissions: { has: "*" } } },
    })) > 0
  );
}

export async function updateAgent(
  db: Db,
  actor: Actor,
  id: string,
  change: { roleId?: string; active?: boolean },
) {
  const agent = await db.agent.findUniqueOrThrow({ where: { id }, include: { role: true } });
  if (id === actor.id && change.active === false)
    return { ok: false as const, error: "You can't deactivate your own account" };
  const losesOwner =
    agent.role.permissions.includes("*") &&
    (change.active === false ||
      (change.roleId !== undefined &&
        !(await db.agentRole.findUnique({ where: { id: change.roleId } }))?.permissions.includes(
          "*",
        )));
  if (losesOwner && !(await anotherActiveOwner(db, id)))
    return { ok: false as const, error: "Keep at least one active Owner" };
  await db.agent.update({
    where: { id },
    data: {
      ...(change.roleId ? { roleId: change.roleId } : {}),
      ...(change.active !== undefined
        ? { active: change.active, sessionVersion: { increment: 1 } }
        : {}),
    },
  });
  await audit(db, actor, "agent.update", { type: "agent", id }, change);
  return { ok: true as const };
}

export async function resetPassword(db: Db, actor: Actor, id: string) {
  const password = newPassword();
  const agent = await db.agent.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(password),
      sessionVersion: { increment: 1 },
      failedLogins: 0,
      lockedUntil: null,
    },
  });
  await audit(db, actor, "agent.reset_password", { type: "agent", id });
  return { email: agent.email, password };
}

export async function changeOwnPassword(
  db: Db,
  actor: Actor,
  current: string,
  next: string,
  confirm: string,
) {
  if (next.length < MIN_PASSWORD)
    return { ok: false as const, error: `Use at least ${MIN_PASSWORD} characters` };
  if (next !== confirm) return { ok: false as const, error: "The new passwords don't match" };
  const agent = await db.agent.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(current, agent.passwordHash)))
    return { ok: false as const, error: "Current password is incorrect" };
  const updated = await db.agent.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } },
  });
  await audit(db, actor, "agent.change_password", { type: "agent", id: actor.id });
  return { ok: true as const, agent: { id: updated.id, sessionVersion: updated.sessionVersion } };
}

const RoleInput = z.object({
  name: z.string().trim().min(2, "Enter a name").max(40),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export async function saveRole(db: Db, actor: Actor, id: string | null, raw: unknown) {
  const p = RoleInput.safeParse(raw);
  if (!p.success) return { ok: false as const, error: p.error.issues[0].message };
  if (id) {
    const role = await db.agentRole.findUniqueOrThrow({ where: { id } });
    if (role.permissions.includes("*"))
      return { ok: false as const, error: "The Owner role always has every permission" };
    await db.agentRole.update({ where: { id }, data: p.data });
  } else {
    if (await db.agentRole.findUnique({ where: { name: p.data.name } }))
      return { ok: false as const, error: "A role with this name already exists" };
    id = (await db.agentRole.create({ data: p.data })).id;
  }
  await audit(
    db,
    actor,
    "role.save",
    { type: "role", id },
    { name: p.data.name, permissions: p.data.permissions },
  );
  return { ok: true as const };
}

export async function deleteRole(db: Db, actor: Actor, id: string) {
  const role = await db.agentRole.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { agents: true } } },
  });
  if (role.permissions.includes("*"))
    return { ok: false as const, error: "The Owner role can't be deleted" };
  if (role._count.agents)
    return { ok: false as const, error: "Move its agents to another role first" };
  await db.agentRole.delete({ where: { id } });
  await audit(db, actor, "role.delete", { type: "role", id }, { name: role.name });
  return { ok: true as const };
}

export const AUDIT_PAGE = 50;

export async function listAudit(db: Db, opts: { type?: string; page?: number }) {
  const where = opts.type ? { targetType: opts.type } : {};
  const total = await db.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE));
  const page = Math.min(pages, Math.max(1, opts.page ?? 1));
  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * AUDIT_PAGE,
    take: AUDIT_PAGE,
  });
  return { rows, total, page, pages };
}
