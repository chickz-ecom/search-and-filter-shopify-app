import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { fmtDate } from "../components/backoffice/ui";
import prisma from "../db.server";
import { requireAgent } from "../lib/backoffice/auth.server";
import { inviteAgent, listStaff, resetPassword, updateAgent } from "../lib/backoffice/staff.server";

// Back-office → Agents (8.3): mời nhân viên (mật khẩu hiện một lần), đổi vai trò, tắt/bật, reset mật khẩu.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const me = await requireAgent(request, "agents.manage");
  return { ...(await listStaff(prisma)), meId: me.id };
};

type ActionData = { ok?: string; error?: string; secret?: { email: string; password: string } };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const me = await requireAgent(request, "agents.manage");
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  switch (form.get("intent")) {
    case "invite": {
      const r = await inviteAgent(prisma, me, {
        email: form.get("email"),
        name: form.get("name"),
        roleId: form.get("roleId"),
      });
      return r.ok ? { secret: { email: r.email, password: r.password } } : { error: r.error };
    }
    case "role": {
      const r = await updateAgent(prisma, me, id, { roleId: String(form.get("roleId")) });
      return r.ok ? { ok: "Role updated." } : { error: r.error };
    }
    case "active": {
      const r = await updateAgent(prisma, me, id, { active: form.get("active") === "true" });
      return r.ok ? { ok: "Account updated." } : { error: r.error };
    }
    case "reset":
      return { secret: await resetPassword(prisma, me, id) };
    default:
      return { error: "Unknown action" };
  }
};

export default function BackofficeAgents() {
  const { agents, roles, meId } = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading="Agents" inlineSize="large">
      <s-stack direction="block" gap="base">
        {r?.ok && <s-banner tone="success">{r.ok}</s-banner>}
        {r?.error && <s-banner tone="critical">{r.error}</s-banner>}
        {r?.secret && (
          <s-banner tone="warning" heading={`Password for ${r.secret.email}`}>
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">{r.secret.password}</s-text>
              <s-text>
                Shown once. Send it over a private channel; they can change it under Account after
                signing in.
              </s-text>
            </s-stack>
          </s-banner>
        )}

        <s-section padding="none">
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Agent</s-table-header>
              <s-table-header listSlot="labeled">Role</s-table-header>
              <s-table-header listSlot="labeled">Last sign-in</s-table-header>
              <s-table-header listSlot="labeled">Status</s-table-header>
              <s-table-header listSlot="inline" />
            </s-table-header-row>
            <s-table-body>
              {agents.map((a) => (
                <s-table-row key={a.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-100">
                      <s-text>{a.name}</s-text>
                      <s-text color="subdued">{a.email}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="role" />
                      <input type="hidden" name="id" value={a.id} />
                      <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="end">
                        <s-select
                          label="Role"
                          labelAccessibilityVisibility="exclusive"
                          name="roleId"
                          value={a.role.id}
                        >
                          {roles.map((role) => (
                            <s-option key={role.id} value={role.id}>
                              {role.name}
                            </s-option>
                          ))}
                        </s-select>
                        <s-button type="submit" variant="tertiary">
                          Save
                        </s-button>
                      </s-grid>
                    </Form>
                  </s-table-cell>
                  <s-table-cell>{fmtDate(a.lastLoginAt)}</s-table-cell>
                  <s-table-cell>
                    {a.active ? (
                      <s-badge tone="success">Active</s-badge>
                    ) : (
                      <s-badge>Deactivated</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      {a.id !== meId && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="active" />
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="active" value={a.active ? "false" : "true"} />
                          <s-button
                            type="submit"
                            variant="tertiary"
                            tone={a.active ? "critical" : "auto"}
                          >
                            {a.active ? "Deactivate" : "Activate"}
                          </s-button>
                        </Form>
                      )}
                      <Form method="post">
                        <input type="hidden" name="intent" value="reset" />
                        <input type="hidden" name="id" value={a.id} />
                        <s-button type="submit" variant="tertiary">
                          Reset password
                        </s-button>
                      </Form>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>

        <s-section heading="Add agent">
          <Form method="post">
            <input type="hidden" name="intent" value="invite" />
            <s-grid gridTemplateColumns="1fr 1fr 1fr auto" gap="base" alignItems="end">
              <s-text-field label="Name" name="name" required />
              <s-email-field label="Email" name="email" required />
              <s-select label="Role" name="roleId">
                {roles.map((role) => (
                  <s-option key={role.id} value={role.id}>
                    {role.name}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit" variant="primary" loading={busy}>
                Add agent
              </s-button>
            </s-grid>
          </Form>
        </s-section>
      </s-stack>
    </s-page>
  );
}
