import type { Prisma } from "@prisma/client";
import type { Db } from "../shop/shop.server";

// Back-office (8.2): ghi lại mọi thay đổi của nhân viên — ai, làm gì, trên đối tượng nào, giá trị trước/sau.
export async function audit(
  db: Db,
  agent: { id: string; email: string },
  action: string,
  target: { type: string; id: string },
  details: Record<string, unknown> = {},
) {
  await db.auditLog.create({
    data: {
      agentId: agent.id,
      agentEmail: agent.email,
      action,
      targetType: target.type,
      targetId: target.id,
      details: details as Prisma.InputJsonValue,
    },
  });
}

/** Chỉ các trường thay đổi: { field: [trước, sau] }. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      out[k] = [before[k] ?? null, after[k] ?? null];
  return out;
}
