import type { ActionFunctionArgs, HeadersFunction, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import prisma from "../db.server";
import { backofficeEnabled, login, startSession } from "../lib/backoffice/auth.server";
import { BACKOFFICE_HEADERS } from "../lib/backoffice/headers";

// Back-office (8.2): đăng nhập nhân viên. Không nằm trong khung /admin (khung đòi đăng nhập).
export const meta: MetaFunction = () => [{ title: "Sign in · Search & Filter back-office" }];

export const loader = async () => {
  if (!backofficeEnabled()) throw new Response("Not found", { status: 404 });
  return null;
};

/** Chỉ quay về trang trong back-office (không cho chuyển hướng ra ngoài). */
const safeNext = (v: string | null) =>
  v && v.startsWith("/admin") && !v.startsWith("//") && !v.includes("\\") ? v : "/admin";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!backofficeEnabled()) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const r = await login(
    prisma,
    String(form.get("email") ?? ""),
    String(form.get("password") ?? ""),
  );
  if (!r.ok)
    return {
      error: "Email or password is incorrect, or the account is locked. Try again in 15 minutes.",
    };
  return redirect(safeNext(new URL(request.url).searchParams.get("next")), {
    headers: { "Set-Cookie": await startSession(request, r.agent) },
  });
};

export default function AdminLogin() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <div style={{ maxWidth: 420, margin: "10vh auto", padding: "0 16px" }}>
        <s-section heading="Search & Filter back-office">
          <Form method="post" action={`/admin/login?${params}`}>
            <s-stack direction="block" gap="base">
              {data?.error && <s-banner tone="critical">{data.error}</s-banner>}
              <s-email-field label="Email" name="email" autocomplete="email" required />
              <s-password-field
                label="Password"
                name="password"
                autocomplete="current-password"
                required
              />
              <s-button type="submit" variant="primary" loading={nav.state !== "idle"}>
                Sign in
              </s-button>
            </s-stack>
          </Form>
        </s-section>
      </div>
    </>
  );
}

export const headers: HeadersFunction = () => BACKOFFICE_HEADERS;
