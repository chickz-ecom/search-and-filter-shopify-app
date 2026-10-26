import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, NavLink, Outlet, useLoaderData } from "react-router";
import { requireAgent } from "../lib/backoffice/auth.server";
import { BACKOFFICE_HEADERS } from "../lib/backoffice/headers";
import { can, type Permission } from "../lib/backoffice/permissions";

// Back-office (Phase 8): khung chung — đăng nhập bắt buộc, menu theo quyền. Polaris web components chạy độc lập
// (không App Bridge, không nhúng trong Shopify admin).
export const meta: MetaFunction = () => [{ title: "Search & Filter back-office" }];

const NAV: { to: string; label: string; permission: Permission; end?: boolean }[] = [
  { to: "/admin", label: "Dashboard", permission: "dashboard.view", end: true },
  { to: "/admin/shops", label: "Shops", permission: "shops.view" },
  { to: "/admin/plans", label: "Plans", permission: "plans.view" },
  { to: "/admin/agents", label: "Agents", permission: "agents.manage" },
  { to: "/admin/roles", label: "Roles", permission: "agents.manage" },
  { to: "/admin/audit", label: "Audit log", permission: "audit.view" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const agent = await requireAgent(request);
  return {
    agent: { name: agent.name, email: agent.email, role: agent.role.name },
    nav: NAV.filter((n) => can(agent.role, n.permission)),
  };
};

export default function BackofficeLayout() {
  const { agent, nav } = useLoaderData<typeof loader>();
  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <style>{`
        .bo { font-family: Inter, -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, sans-serif; display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; background: #f1f1f1; }
        .bo-side { background: #fff; border-right: 1px solid #e3e3e3; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
        .bo-brand { font-weight: 650; padding: 4px 8px 12px; }
        .bo-side a { color: #303030; text-decoration: none; padding: 6px 8px; border-radius: 8px; font-size: 14px; }
        .bo-side a:hover { background: #f1f1f1; }
        .bo-side a.active { background: #ebebeb; font-weight: 600; }
        .bo-who { margin-top: auto; padding: 8px; font-size: 13px; color: #616161; display: grid; gap: 8px; }
        .bo-main { min-width: 0; padding: 8px 0 32px; }
        @media (max-width: 760px) {
          .bo { grid-template-columns: 1fr; }
          .bo-side { flex-direction: row; flex-wrap: wrap; border-right: 0; border-bottom: 1px solid #e3e3e3; }
          .bo-brand { width: 100%; padding-bottom: 4px; }
          .bo-who { margin-top: 0; width: 100%; }
        }
      `}</style>
      <div className="bo">
        <nav className="bo-side" aria-label="Back-office">
          <div className="bo-brand">Search &amp; Filter</div>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
          <div className="bo-who">
            <NavLink to="/admin/account">
              {agent.name} · {agent.role}
            </NavLink>
            <Form method="post" action="/admin/logout">
              <s-button type="submit" variant="tertiary">
                Sign out
              </s-button>
            </Form>
          </div>
        </nav>
        <main className="bo-main">
          <Outlet />
        </main>
      </div>
    </>
  );
}

export const headers: HeadersFunction = () => BACKOFFICE_HEADERS;
