import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { fmtNum, fmtUsd, Stat } from "../components/backoffice/ui";
import prisma from "../db.server";
import { requireAgent } from "../lib/backoffice/auth.server";
import { getDashboard } from "../lib/backoffice/manage.server";

// Back-office → Dashboard (8.3): shop đang cài, cài/gỡ 30 ngày, MRR ước tính theo gói, lỗi sync, vượt giới hạn.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAgent(request, "dashboard.view");
  return getDashboard(prisma);
};

export default function BackofficeDashboard() {
  const d = useLoaderData<typeof loader>();
  return (
    <s-page heading="Dashboard" inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <Stat
            label="Active shops"
            value={fmtNum(d.activeShops)}
            hint={`${d.comped} on a complimentary plan`}
          />
          <Stat label="Installs (30 days)" value={fmtNum(d.installs30)} />
          <Stat label="Uninstalls (30 days)" value={fmtNum(d.uninstalls30)} />
          <Stat
            label="Estimated MRR"
            value={fmtUsd(d.mrr)}
            hint="From plan prices set here; billing is in the Partner Dashboard"
          />
          <Stat label="Searches (30 days)" value={fmtNum(d.searches30)} />
        </s-grid>

        <s-section heading="Shops by plan" padding="none">
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Plan</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">
                Shops
              </s-table-header>
              <s-table-header listSlot="labeled" format="currency">
                MRR
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.plans.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <Link to={`/admin/shops?plan=${encodeURIComponent(p.id)}`}>{p.name}</Link>
                  </s-table-cell>
                  <s-table-cell>{fmtNum(p.shops)}</s-table-cell>
                  <s-table-cell>{fmtUsd(p.mrr)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <s-section heading="Sync errors">
            {d.syncErrors.length === 0 ? (
              <s-paragraph color="subdued">No shop has a failed sync.</s-paragraph>
            ) : (
              <s-stack direction="block" gap="small-200">
                {d.syncErrors.map((s) => (
                  <Link key={s.id} to={`/admin/shops/${s.id}`}>
                    {s.domain}
                  </Link>
                ))}
                <Link to="/admin/shops?filter=error">See all</Link>
              </s-stack>
            )}
          </s-section>
          <s-section heading="Catalog larger than the plan">
            {d.overLimit.length === 0 ? (
              <s-paragraph color="subdued">Every shop fits its plan.</s-paragraph>
            ) : (
              <s-stack direction="block" gap="small-200">
                {d.overLimit.map((s) => (
                  <s-stack key={s.id} direction="inline" gap="small-200">
                    <Link to={`/admin/shops/${s.id}`}>{s.domain}</Link>
                    <s-text color="subdued">
                      {fmtNum(s.products)} / {fmtNum(s.limit)} products
                    </s-text>
                  </s-stack>
                ))}
                <Link to="/admin/shops?filter=over">See all</Link>
              </s-stack>
            )}
          </s-section>
        </s-grid>
      </s-stack>
    </s-page>
  );
}
