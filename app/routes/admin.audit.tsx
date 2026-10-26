import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useLocation } from "react-router";
import { fmtDate, fmtNum, Pager } from "../components/backoffice/ui";
import prisma from "../db.server";
import { requireAgent } from "../lib/backoffice/auth.server";
import { listAudit } from "../lib/backoffice/staff.server";

// Back-office → Audit log (8.3): mọi thay đổi của nhân viên, mới nhất trước.
const TYPES = [
  { value: "", label: "Everything" },
  { value: "shop", label: "Shops" },
  { value: "plan", label: "Plans" },
  { value: "agent", label: "Agents" },
  { value: "role", label: "Roles" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAgent(request, "audit.view");
  const p = new URL(request.url).searchParams;
  const type = TYPES.some((t) => t.value === p.get("type")) ? p.get("type")! : "";
  return {
    ...(await listAudit(prisma, { type: type || undefined, page: Number(p.get("page") ?? 1) })),
    type,
  };
};

const target = (type: string, id: string) =>
  type === "shop" ? (
    <Link to={`/admin/shops/${id}`}>shop</Link>
  ) : type === "plan" ? (
    <Link to={`/admin/plans/${id}`}>{id}</Link>
  ) : (
    `${type} ${id.slice(0, 8)}`
  );

export default function BackofficeAudit() {
  const d = useLoaderData<typeof loader>();
  const location = useLocation();
  return (
    <s-page heading="Audit log" inlineSize="large">
      <s-stack direction="block" gap="base">
        <s-section>
          <Form method="get">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
              <s-select label="Show" name="type" value={d.type}>
                {TYPES.map((t) => (
                  <s-option key={t.value} value={t.value}>
                    {t.label}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit">Filter</s-button>
            </s-grid>
          </Form>
        </s-section>
        <s-section padding="none">
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">When</s-table-header>
              <s-table-header listSlot="labeled">Agent</s-table-header>
              <s-table-header listSlot="labeled">Action</s-table-header>
              <s-table-header listSlot="labeled">Target</s-table-header>
              <s-table-header listSlot="labeled">Details</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {d.rows.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{fmtDate(row.createdAt)}</s-table-cell>
                  <s-table-cell>{row.agentEmail}</s-table-cell>
                  <s-table-cell>{row.action}</s-table-cell>
                  <s-table-cell>{target(row.targetType, row.targetId)}</s-table-cell>
                  <s-table-cell>
                    <s-text color="subdued">{JSON.stringify(row.details).slice(0, 200)}</s-text>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-box padding="base">
            <s-stack
              direction="inline"
              gap="base"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-text color="subdued">{fmtNum(d.total)} entries</s-text>
              <Pager page={d.page} pages={d.pages} search={location.search} />
            </s-stack>
          </s-box>
        </s-section>
      </s-stack>
    </s-page>
  );
}
