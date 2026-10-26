import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { fmtDate, fmtNum } from "../components/backoffice/ui";
import prisma from "../db.server";
import { planById, plans } from "../lib/billing/plans";
import { requireAgent } from "../lib/backoffice/auth.server";
import {
  queueShopSync,
  saveNotes,
  saveOverrides,
  setBlocked,
  shopDetail,
} from "../lib/backoffice/manage.server";
import { can } from "../lib/backoffice/permissions";

// Back-office → Shops → chi tiết (8.3): quyền lợi hiệu lực, gói tặng, ghi đè, khoá, ghi chú, sync, lịch sử.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const agent = await requireAgent(request, "shops.view");
  const d = await shopDetail(prisma, params.id!);
  if (!d) throw new Response("Not found", { status: 404 });
  return {
    ...d,
    canManage: can(agent.role, "shops.manage"),
    plans: plans().map((p) => ({ id: p.id, name: p.name })),
  };
};

type ActionData = { ok?: string; error?: string; errors?: Record<string, string> };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionData> => {
  const agent = await requireAgent(request, "shops.manage");
  const id = params.id!;
  const form = await request.formData();
  switch (form.get("intent")) {
    case "overrides": {
      const r = await saveOverrides(prisma, agent, id, {
        compPlan: String(form.get("compPlan") ?? ""),
        compUntil: String(form.get("compUntil") ?? ""),
        maxProducts: String(form.get("maxProducts") ?? ""),
        rpm: String(form.get("rpm") ?? ""),
        semantic: form.get("semantic") === "on",
        headless: form.get("headless") === "on",
      });
      return r.ok ? { ok: "Plan and limits saved." } : { errors: r.errors };
    }
    case "block":
      await setBlocked(prisma, agent, id, true, String(form.get("reason") ?? ""));
      return {
        ok: "Search is paused for this shop. Its storefront shows the theme's native results.",
      };
    case "unblock":
      await setBlocked(prisma, agent, id, false, "");
      return { ok: "Search is back on for this shop." };
    case "notes":
      await saveNotes(prisma, agent, id, String(form.get("notes") ?? ""));
      return { ok: "Notes saved." };
    case "sync":
    case "reindex": {
      const r = await queueShopSync(
        prisma,
        agent,
        id,
        form.get("intent") === "sync" ? "full" : "reindex",
      );
      return r.ok
        ? { ok: "Queued. Progress shows on the merchant's Sync page." }
        : { error: r.error };
    }
    default:
      return { error: "Unknown action" };
  }
};

export default function BackofficeShop() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const { shop, entitlements: e, overrides: o } = d;
  const disabled = !d.canManage;
  const errors = result?.errors ?? {};
  return (
    <s-page heading={shop.domain} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/admin/shops">
        Shops
      </s-link>
      <s-stack direction="block" gap="base">
        {result?.ok && <s-banner tone="success">{result.ok}</s-banner>}
        {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
        {e.blocked && (
          <s-banner tone="critical" heading="Search is paused for this shop">
            {o.blockedReason || "No reason recorded."}
          </s-banner>
        )}

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <s-section heading="Shop">
            <s-stack direction="block" gap="small-200">
              <s-text>
                Status:{" "}
                {shop.uninstalledAt ? `Uninstalled ${fmtDate(shop.uninstalledAt)}` : "Installed"}
              </s-text>
              <s-text>Installed: {fmtDate(shop.installedAt)}</s-text>
              <s-text>
                Products: {fmtNum(shop.productCount)} · indexed {fmtNum(shop.indexedCount)}
              </s-text>
              <s-text>
                Sync: {shop.syncState} · last full sync {fmtDate(shop.lastFullSyncAt)}
              </s-text>
              <s-text>Searches (30 days): {fmtNum(d.searches30)}</s-text>
              <s-link href={`https://${shop.domain}`} target="_blank">
                Open storefront
              </s-link>
            </s-stack>
          </s-section>
          <s-section heading="Effective plan">
            <s-stack direction="block" gap="small-200">
              <s-text>
                Paying for: {d.paidPlan.name} (checked {fmtDate(shop.planCheckedAt)})
              </s-text>
              <s-text>
                Using: {planById(e.planId).name}
                {e.comped && o.compUntil
                  ? ` until ${fmtDate(o.compUntil)}`
                  : e.comped
                    ? " (no end date)"
                    : ""}
              </s-text>
              <s-text>
                Products limit: {fmtNum(e.maxProducts)}
                {shop.productCount > e.maxProducts ? " — over the limit" : ""}
              </s-text>
              <s-text>Requests per minute: {fmtNum(e.rpm)}</s-text>
              <s-text>
                AI search: {e.semantic ? "Yes" : "No"} · Headless: {e.headless ? "Yes" : "No"}
              </s-text>
            </s-stack>
          </s-section>
        </s-grid>

        <s-section heading="Complimentary plan and overrides">
          <Form method="post">
            <input type="hidden" name="intent" value="overrides" />
            <s-stack direction="block" gap="base">
              <s-paragraph color="subdued">
                Give a plan for free (for example to partners or for a support case) and raise
                limits for this shop only. The paid plan in Shopify doesn’t change.
              </s-paragraph>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-select
                  label="Complimentary plan"
                  name="compPlan"
                  value={o.compPlan ?? ""}
                  disabled={disabled}
                  error={errors.compPlan}
                >
                  <s-option value="">None</s-option>
                  {d.plans.map((p) => (
                    <s-option key={p.id} value={p.id}>
                      {p.name}
                    </s-option>
                  ))}
                </s-select>
                <s-date-field
                  label="Until (optional)"
                  name="compUntil"
                  value={o.compUntil?.slice(0, 10) ?? ""}
                  disabled={disabled}
                  error={errors.compUntil}
                  details="Leave empty for no end date."
                />
                <s-number-field
                  label="Products limit override"
                  name="maxProducts"
                  value={o.maxProducts !== undefined ? String(o.maxProducts) : ""}
                  min={1}
                  disabled={disabled}
                  error={errors.maxProducts}
                  details="Empty uses the plan's limit."
                />
                <s-number-field
                  label="Requests per minute override"
                  name="rpm"
                  value={o.rpm !== undefined ? String(o.rpm) : ""}
                  min={10}
                  disabled={disabled}
                  error={errors.rpm}
                  details="Empty uses the plan's limit."
                />
              </s-grid>
              <s-checkbox
                label="Grant AI search"
                name="semantic"
                checked={Boolean(o.semantic)}
                disabled={disabled}
              />
              <s-checkbox
                label="Grant headless API access"
                name="headless"
                checked={Boolean(o.headless)}
                disabled={disabled}
              />
              {!disabled && (
                <s-button type="submit" variant="primary" loading={busy}>
                  Save plan and limits
                </s-button>
              )}
            </s-stack>
          </Form>
        </s-section>

        {!disabled && (
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
            <s-section heading="Pause search">
              {e.blocked ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="unblock" />
                  <s-button type="submit">Turn search back on</s-button>
                </Form>
              ) : (
                <Form method="post">
                  <input type="hidden" name="intent" value="block" />
                  <s-stack direction="block" gap="base">
                    <s-paragraph color="subdued">
                      The storefront falls back to the theme’s native search and collections. Use
                      for abuse or unpaid accounts.
                    </s-paragraph>
                    <s-text-field label="Reason" name="reason" required />
                    <s-button type="submit" tone="critical">
                      Pause search
                    </s-button>
                  </s-stack>
                </Form>
              )}
            </s-section>
            <s-section heading="Sync">
              <s-stack direction="inline" gap="base">
                <Form method="post">
                  <input type="hidden" name="intent" value="sync" />
                  <s-button type="submit">Sync from Shopify</s-button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="reindex" />
                  <s-button type="submit">Reindex</s-button>
                </Form>
              </s-stack>
            </s-section>
          </s-grid>
        )}

        <s-section heading="Internal notes">
          <Form method="post">
            <input type="hidden" name="intent" value="notes" />
            <s-stack direction="block" gap="base">
              <s-text-area
                label="Notes"
                labelAccessibilityVisibility="exclusive"
                name="notes"
                rows={4}
                value={shop.adminNotes ?? ""}
                disabled={disabled}
              />
              {!disabled && <s-button type="submit">Save notes</s-button>}
            </s-stack>
          </Form>
        </s-section>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
          <s-section heading="Recent syncs" padding="none">
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Started</s-table-header>
                <s-table-header listSlot="labeled">Type</s-table-header>
                <s-table-header listSlot="labeled">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {d.jobs.map((j) => (
                  <s-table-row key={j.id}>
                    <s-table-cell>{fmtDate(j.startedAt)}</s-table-cell>
                    <s-table-cell>{j.type}</s-table-cell>
                    <s-table-cell>
                      {j.status}
                      {j.error ? ` · ${j.error.slice(0, 120)}` : ""}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
          <s-section heading="Changes by staff" padding="none">
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">When</s-table-header>
                <s-table-header listSlot="labeled">Who</s-table-header>
                <s-table-header listSlot="labeled">What</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {d.history.map((h) => (
                  <s-table-row key={h.id}>
                    <s-table-cell>{fmtDate(h.createdAt)}</s-table-cell>
                    <s-table-cell>{h.agentEmail}</s-table-cell>
                    <s-table-cell>{h.action}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </s-grid>
      </s-stack>
    </s-page>
  );
}
