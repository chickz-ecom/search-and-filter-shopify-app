import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { fmtNum, fmtUsd } from "../components/backoffice/ui";
import prisma from "../db.server";
import { requireAgent } from "../lib/backoffice/auth.server";
import { listPlansWithUsage } from "../lib/backoffice/manage.server";
import { can } from "../lib/backoffice/permissions";

// Back-office → Plans (8.3): quyền lợi theo gói. Giá thật / trial đặt ở Partner Dashboard (Shopify App Pricing).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const agent = await requireAgent(request, "plans.view");
  return { plans: await listPlansWithUsage(prisma), canManage: can(agent.role, "plans.manage") };
};

const yes = (v: boolean) =>
  v ? <s-badge tone="success">Yes</s-badge> : <s-text color="subdued">—</s-text>;

export default function BackofficePlans() {
  const { plans, canManage } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Plans" inlineSize="large">
      {canManage && (
        <s-button slot="primary-action" variant="primary" href="/admin/plans/new">
          Add plan
        </s-button>
      )}
      <s-stack direction="block" gap="base">
        <s-banner tone="info">
          Prices, trials and billing intervals are set in the Partner Dashboard (Shopify App
          Pricing). A plan’s handle here must match its handle there. Limits and features below
          apply to every shop on the plan within about 30 seconds.
        </s-banner>
        <s-section padding="none">
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Plan</s-table-header>
              <s-table-header listSlot="labeled" format="currency">
                Price / month
              </s-table-header>
              <s-table-header listSlot="labeled" format="numeric">
                Products
              </s-table-header>
              <s-table-header listSlot="labeled" format="numeric">
                Requests / min
              </s-table-header>
              <s-table-header listSlot="labeled">AI search</s-table-header>
              <s-table-header listSlot="labeled">Headless</s-table-header>
              <s-table-header listSlot="labeled">On Plans page</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">
                Shops
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {plans.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-100">
                      {canManage ? (
                        <Link to={`/admin/plans/${encodeURIComponent(p.id)}`}>{p.name}</Link>
                      ) : (
                        p.name
                      )}
                      <s-text color="subdued">{p.id}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{fmtUsd(p.priceUsd)}</s-table-cell>
                  <s-table-cell>{fmtNum(p.maxProducts)}</s-table-cell>
                  <s-table-cell>{fmtNum(p.rpm)}</s-table-cell>
                  <s-table-cell>{yes(p.semantic)}</s-table-cell>
                  <s-table-cell>{yes(p.headless)}</s-table-cell>
                  <s-table-cell>{p.visible ? yes(true) : <s-badge>Hidden</s-badge>}</s-table-cell>
                  <s-table-cell>
                    <Link to={`/admin/shops?plan=${encodeURIComponent(p.id)}`}>
                      {fmtNum(p.shops)}
                    </Link>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      </s-stack>
    </s-page>
  );
}
