import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useLocation } from "react-router";
import { fmtDate, fmtNum, Pager } from "../components/backoffice/ui";
import prisma from "../db.server";
import { planById, plans } from "../lib/billing/plans";
import { requireAgent } from "../lib/backoffice/auth.server";
import { listShops, type ShopFilter } from "../lib/backoffice/manage.server";

// Back-office → Shops (8.3): tìm theo domain, lọc theo gói / trạng thái.
const FILTERS: { value: ShopFilter; label: string }[] = [
  { value: "all", label: "All shops" },
  { value: "active", label: "Installed" },
  { value: "uninstalled", label: "Uninstalled" },
  { value: "blocked", label: "Blocked" },
  { value: "comped", label: "Complimentary plan" },
  { value: "error", label: "Sync error" },
  { value: "over", label: "Over plan limit" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAgent(request, "shops.view");
  const p = new URL(request.url).searchParams;
  const filter = (FILTERS.find((f) => f.value === p.get("filter"))?.value ??
    "active") as ShopFilter;
  const q = p.get("q") ?? "";
  const plan = p.get("plan") ?? "";
  const result = await listShops(prisma, {
    q,
    plan: plan || undefined,
    filter,
    page: Number(p.get("page") ?? 1),
  });
  return { ...result, q, plan, filter, plans: plans().map((x) => ({ id: x.id, name: x.name })) };
};

export default function BackofficeShops() {
  const d = useLoaderData<typeof loader>();
  const location = useLocation();
  return (
    <s-page heading="Shops" inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-section>
          <Form method="get">
            <s-grid gridTemplateColumns="2fr 1fr 1fr auto" gap="base" alignItems="end">
              <s-search-field
                label="Shop domain"
                name="q"
                value={d.q}
                placeholder="example.myshopify.com"
              />
              <s-select label="Plan" name="plan" value={d.plan}>
                <s-option value="">All plans</s-option>
                {d.plans.map((p) => (
                  <s-option key={p.id} value={p.id}>
                    {p.name}
                  </s-option>
                ))}
              </s-select>
              <s-select label="Status" name="filter" value={d.filter}>
                {FILTERS.map((f) => (
                  <s-option key={f.value} value={f.value}>
                    {f.label}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit">Search</s-button>
            </s-grid>
          </Form>
        </s-section>

        <s-section padding="none">
          {d.shops.length === 0 ? (
            <s-box padding="base">
              <s-paragraph color="subdued">No shops match.</s-paragraph>
            </s-box>
          ) : (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Shop</s-table-header>
                <s-table-header listSlot="labeled">Plan</s-table-header>
                <s-table-header listSlot="labeled" format="numeric">
                  Products
                </s-table-header>
                <s-table-header listSlot="labeled">Status</s-table-header>
                <s-table-header listSlot="labeled">Installed</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {d.shops.map((s) => (
                  <s-table-row key={s.id}>
                    <s-table-cell>
                      <Link to={`/admin/shops/${s.id}`}>{s.domain}</Link>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-text>{planById(s.plan).name}</s-text>
                        {s.comped && (
                          <s-badge tone="info">Comp: {planById(s.effectivePlan).name}</s-badge>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-text>{fmtNum(s.productCount)}</s-text>
                        {s.over && <s-badge tone="warning">Over limit</s-badge>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        {s.uninstalledAt ? (
                          <s-badge>Uninstalled</s-badge>
                        ) : (
                          <s-badge tone="success">Installed</s-badge>
                        )}
                        {s.blocked && <s-badge tone="critical">Blocked</s-badge>}
                        {s.syncState === "ERROR" && <s-badge tone="critical">Sync error</s-badge>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{fmtDate(s.installedAt)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          <s-box padding="base">
            <s-stack
              direction="inline"
              gap="base"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-text color="subdued">{fmtNum(d.total)} shops</s-text>
              <Pager page={d.page} pages={d.pages} search={location.search} />
            </s-stack>
          </s-box>
        </s-section>
      </s-stack>
    </s-page>
  );
}
