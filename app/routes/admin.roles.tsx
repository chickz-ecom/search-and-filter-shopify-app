import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireAgent } from "../lib/backoffice/auth.server";
import { PERMISSIONS } from "../lib/backoffice/permissions";
import { deleteRole, listStaff, saveRole } from "../lib/backoffice/staff.server";

// Back-office → Roles (8.3): mỗi vai trò là một tập quyền. Owner luôn có mọi quyền.
const LABELS: Record<(typeof PERMISSIONS)[number], string> = {
  "dashboard.view": "View the dashboard",
  "shops.view": "View shops",
  "shops.manage": "Change shops (plans, limits, pause, sync, notes)",
  "plans.view": "View plans",
  "plans.manage": "Change plans",
  "agents.manage": "Manage agents and roles",
  "audit.view": "View the audit log",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAgent(request, "agents.manage");
  return { roles: (await listStaff(prisma)).roles };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const me = await requireAgent(request, "agents.manage");
  const form = await request.formData();
  const id = String(form.get("id") ?? "") || null;
  if (form.get("intent") === "delete") {
    const r = await deleteRole(prisma, me, id!);
    return r.ok ? { ok: "Role deleted." } : { error: r.error };
  }
  const r = await saveRole(prisma, me, id, {
    name: form.get("name"),
    description: String(form.get("description") ?? "") || undefined,
    permissions: PERMISSIONS.filter((p) => form.get(p) === "on"),
  });
  return r.ok ? { ok: "Role saved." } : { error: r.error };
};

function RoleForm(p: {
  role?: {
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
    agents: number;
  };
}) {
  const owner = p.role?.permissions.includes("*");
  return (
    <Form method="post">
      <input type="hidden" name="id" value={p.role?.id ?? ""} />
      <s-stack direction="block" gap="base">
        <s-grid gridTemplateColumns="1fr 2fr" gap="base">
          <s-text-field
            label="Name"
            name="name"
            value={p.role?.name ?? ""}
            disabled={owner}
            required
          />
          <s-text-field
            label="Description"
            name="description"
            value={p.role?.description ?? ""}
            disabled={owner}
          />
        </s-grid>
        {owner ? (
          <s-paragraph color="subdued">
            Owners have every permission, including future ones.
          </s-paragraph>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="small-200">
            {PERMISSIONS.map((perm) => (
              <s-checkbox
                key={perm}
                label={LABELS[perm]}
                name={perm}
                checked={p.role?.permissions.includes(perm) ?? false}
              />
            ))}
          </s-grid>
        )}
        {!owner && (
          <s-stack direction="inline" gap="base">
            <s-button type="submit" variant="primary">
              {p.role ? "Save role" : "Add role"}
            </s-button>
          </s-stack>
        )}
      </s-stack>
    </Form>
  );
}

export default function BackofficeRoles() {
  const { roles } = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  return (
    <s-page heading="Roles" inlineSize="large">
      <s-stack direction="block" gap="base">
        {r && "ok" in r && <s-banner tone="success">{r.ok}</s-banner>}
        {r && "error" in r && <s-banner tone="critical">{r.error}</s-banner>}
        {roles.map((role) => (
          <s-section key={role.id} heading={`${role.name} · ${role._count.agents} agents`}>
            <s-stack direction="block" gap="base">
              <RoleForm role={{ ...role, agents: role._count.agents }} />
              {!role.permissions.includes("*") && role._count.agents === 0 && (
                <Form method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={role.id} />
                  <s-button type="submit" variant="tertiary" tone="critical">
                    Delete role
                  </s-button>
                </Form>
              )}
            </s-stack>
          </s-section>
        ))}
        <s-section heading="Add role">
          <RoleForm />
        </s-section>
      </s-stack>
    </s-page>
  );
}
