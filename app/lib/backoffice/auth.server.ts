import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createCookieSessionStorage, redirect } from "react-router";
import type { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { env } from "../env.server";
import type { Db } from "../shop/shop.server";
import { can, DEFAULT_ROLES, MIN_PASSWORD, type Permission } from "./permissions";

export { MIN_PASSWORD };

// Back-office (8.2): đăng nhập riêng cho nhân viên vận hành (không dùng phiên Shopify).
// - Mật khẩu scrypt (N=2^15) + salt ngẫu nhiên; so sánh thời gian hằng.
// - Sai 5 lần → khoá 15 phút; email không có / bị khoá / bị tắt → cùng thông báo "invalid".
// - Cookie riêng (HttpOnly, SameSite=Strict, Path=/admin, 12 giờ) ký bằng ADMIN_SESSION_SECRET;
//   thiếu secret → back-office tắt (404). sessionVersion tăng (đổi mật khẩu, tắt tài khoản) → phiên cũ hết hiệu lực.

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, PARAMS);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Băm giả để thời gian trả lời như nhau khi email không tồn tại. */
let decoy: Promise<string> | null = null;

export type LoginResult =
  { ok: true; agent: { id: string; sessionVersion: number } } | { ok: false; error: "invalid" };

export async function login(
  db: Db,
  emailRaw: string,
  password: string,
  now = new Date(),
): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const agent = await db.agent.findUnique({ where: { email } });
  if (!agent) {
    decoy ??= hashPassword("decoy-password");
    await verifyPassword(password, await decoy);
    return { ok: false, error: "invalid" };
  }
  const locked = agent.lockedUntil && agent.lockedUntil > now;
  const valid = await verifyPassword(password, agent.passwordHash);
  if (!agent.active || locked) return { ok: false, error: "invalid" };
  if (!valid) {
    const failures = agent.failedLogins + 1;
    await db.agent.update({
      where: { id: agent.id },
      data:
        failures >= MAX_FAILURES
          ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) }
          : { failedLogins: failures },
    });
    return { ok: false, error: "invalid" };
  }
  await db.agent.update({
    where: { id: agent.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
  });
  return { ok: true, agent: { id: agent.id, sessionVersion: agent.sessionVersion } };
}

/** Tạo agent (và vai trò mặc định nếu chưa có). Dùng bởi script tạo agent đầu tiên và trang Agents. */
export async function createAgent(
  db: Db,
  input: { email: string; name: string; password: string; role: string },
) {
  if (input.password.length < MIN_PASSWORD)
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  for (const r of DEFAULT_ROLES)
    await db.agentRole.upsert({ where: { name: r.name }, update: {}, create: r });
  const role = await db.agentRole.findUniqueOrThrow({ where: { name: input.role } });
  const agent = await db.agent.create({
    data: {
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      roleId: role.id,
    },
  });
  return { agent, role };
}

// ---------- phiên ----------

type SessionData = { agentId: string; ver: number };
let storage: ReturnType<typeof createCookieSessionStorage<SessionData>> | null = null;
function sessions() {
  const secret = env().ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  storage ??= createCookieSessionStorage<SessionData>({
    cookie: {
      name: "__sa_admin",
      httpOnly: true,
      sameSite: "strict",
      path: "/admin",
      secure: process.env.NODE_ENV === "production",
      secrets: [secret],
      maxAge: 12 * 3600,
    },
  });
  return storage;
}

/** Back-office có bật không (đủ secret). */
export const backofficeEnabled = () => sessions() !== null;

const notFound = () => new Response("Not found", { status: 404 });

export async function startSession(
  request: Request,
  agent: { id: string; sessionVersion: number },
) {
  const s = sessions();
  if (!s) throw notFound();
  const session = await s.getSession(request.headers.get("Cookie"));
  session.set("agentId", agent.id);
  session.set("ver", agent.sessionVersion);
  return s.commitSession(session);
}

export async function endSession(request: Request) {
  const s = sessions();
  if (!s) throw notFound();
  return s.destroySession(await s.getSession(request.headers.get("Cookie")));
}

export type CurrentAgent = Prisma.AgentGetPayload<{ include: { role: true } }>;

/** Agent đang đăng nhập (kèm vai trò) hoặc chuyển tới trang đăng nhập; thiếu quyền → 403. */
export async function requireAgent(
  request: Request,
  permission?: Permission,
  db: Db = prisma,
): Promise<CurrentAgent> {
  const s = sessions();
  if (!s) throw notFound();
  const session = await s.getSession(request.headers.get("Cookie"));
  const id = session.get("agentId");
  const agent = id ? await db.agent.findUnique({ where: { id }, include: { role: true } }) : null;
  if (!agent || !agent.active || agent.sessionVersion !== session.get("ver")) {
    const next = new URL(request.url).pathname;
    throw redirect(`/admin/login?next=${encodeURIComponent(next)}`);
  }
  if (permission && !can(agent.role, permission))
    throw new Response("You don't have permission to do this.", { status: 403 });
  return agent;
}
