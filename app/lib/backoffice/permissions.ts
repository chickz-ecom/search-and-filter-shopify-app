// Back-office (8.2): danh mục quyền. Vai trò (AgentRole) là tập các quyền này; "*" = mọi quyền (Owner).

export const PERMISSIONS = [
  "dashboard.view",
  "shops.view",
  "shops.manage",
  "plans.view",
  "plans.manage",
  "agents.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Vai trò mặc định tạo khi chưa có (script tạo agent đầu tiên). */
export const DEFAULT_ROLES: { name: string; description: string; permissions: string[] }[] = [
  { name: "Owner", description: "Full access, including staff and roles.", permissions: ["*"] },
  {
    name: "Support",
    description: "Helps merchants: views and updates shops, reads plans and the audit log.",
    permissions: ["dashboard.view", "shops.view", "shops.manage", "plans.view", "audit.view"],
  },
  {
    name: "Viewer",
    description: "Read-only access to the dashboard, shops and plans.",
    permissions: ["dashboard.view", "shops.view", "plans.view"],
  },
];

/** Độ dài mật khẩu tối thiểu của nhân viên (dùng cả ở form). */
export const MIN_PASSWORD = 12;

export function can(role: { permissions: string[] }, permission: Permission): boolean {
  return role.permissions.includes("*") || role.permissions.includes(permission);
}
