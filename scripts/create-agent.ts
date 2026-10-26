// Tạo nhân viên back-office (Phase 8) — dùng cho tài khoản đầu tiên (Owner) hoặc khi không vào được trang Agents.
//   npm run admin:create-agent -- --email you@example.com --name "Your name" [--role Owner|Support|Viewer]
// Mật khẩu: lấy từ biến môi trường ADMIN_PASSWORD (≥ 12 ký tự), không có thì sinh ngẫu nhiên và in ra MỘT lần.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { createAgent } from "../app/lib/backoffice/auth.server";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "Owner" },
  },
});
if (!values.email || !values.name) {
  console.error(
    'Usage: npm run admin:create-agent -- --email you@example.com --name "Your name" [--role Owner]',
  );
  process.exit(1);
}
const generated = !process.env.ADMIN_PASSWORD;
const password = process.env.ADMIN_PASSWORD ?? randomBytes(18).toString("base64url");
const db = new PrismaClient();
try {
  const { agent, role } = await createAgent(db, {
    email: values.email,
    name: values.name,
    password,
    role: values.role!,
  });
  console.log(`Created ${agent.email} (${role.name}).`);
  if (generated) console.log(`Password (shown once, change it after signing in): ${password}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
