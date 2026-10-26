import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireAgent, startSession } from "../lib/backoffice/auth.server";
import { MIN_PASSWORD } from "../lib/backoffice/permissions";
import { changeOwnPassword } from "../lib/backoffice/staff.server";

// Back-office → Account (8.3): tự đổi mật khẩu. Đổi xong → phiên ở máy khác hết hiệu lực, phiên này được cấp lại.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const me = await requireAgent(request);
  return { name: me.name, email: me.email, role: me.role.name };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const me = await requireAgent(request);
  const form = await request.formData();
  const r = await changeOwnPassword(
    prisma,
    me,
    String(form.get("current") ?? ""),
    String(form.get("next") ?? ""),
    String(form.get("confirm") ?? ""),
  );
  if (!r.ok) return { error: r.error };
  return data(
    { ok: "Password changed. Other sessions were signed out." },
    { headers: { "Set-Cookie": await startSession(request, r.agent) } },
  );
};

export default function BackofficeAccount() {
  const me = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  return (
    <s-page heading="Account" inlineSize="small">
      <s-stack direction="block" gap="base">
        {r && "ok" in r && <s-banner tone="success">{r.ok}</s-banner>}
        {r && "error" in r && <s-banner tone="critical">{r.error}</s-banner>}
        <s-section>
          <s-paragraph>
            {me.name} · {me.email} · {me.role}
          </s-paragraph>
        </s-section>
        <s-section heading="Change password">
          <Form method="post">
            <s-stack direction="block" gap="base">
              <s-password-field
                label="Current password"
                name="current"
                autocomplete="current-password"
                required
              />
              <s-password-field
                label="New password"
                name="next"
                autocomplete="new-password"
                minLength={MIN_PASSWORD}
                required
                details={`At least ${MIN_PASSWORD} characters.`}
              />
              <s-password-field
                label="Confirm new password"
                name="confirm"
                autocomplete="new-password"
                required
              />
              <s-button type="submit" variant="primary">
                Change password
              </s-button>
            </s-stack>
          </Form>
        </s-section>
      </s-stack>
    </s-page>
  );
}
