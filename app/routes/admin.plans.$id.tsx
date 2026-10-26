import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import prisma from "../db.server";
import { planById, plans } from "../lib/billing/plans";
import { refreshPlans } from "../lib/billing/plans-registry.server";
import { requireAgent } from "../lib/backoffice/auth.server";
import { deletePlan, savePlan } from "../lib/backoffice/manage.server";

// Back-office → Plans → thêm / sửa gói (8.3). `new` = thêm.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireAgent(request, "plans.manage");
  await refreshPlans(prisma, { force: true });
  const isNew = params.id === "new";
  if (!isNew && !plans().some((p) => p.id === params.id))
    throw new Response("Not found", { status: 404 });
  const shops = isNew
    ? 0
    : await prisma.shop.count({ where: { plan: params.id, uninstalledAt: null } });
  return {
    isNew,
    plan: isNew
      ? {
          id: "",
          name: "",
          priceUsd: 0,
          maxProducts: 1000,
          rpm: 3000,
          semantic: false,
          headless: false,
          visible: true,
          position: plans().length,
        }
      : planById(params.id),
    shops,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const agent = await requireAgent(request, "plans.manage");
  const form = await request.formData();
  if (form.get("intent") === "delete") {
    const r = await deletePlan(prisma, agent, params.id!);
    return r.ok ? redirect("/admin/plans") : { errors: { form: r.error! } };
  }
  const isNew = params.id === "new";
  const r = await savePlan(
    prisma,
    agent,
    {
      id: isNew ? form.get("id") : params.id,
      name: form.get("name"),
      priceUsd: form.get("priceUsd"),
      maxProducts: form.get("maxProducts"),
      rpm: form.get("rpm"),
      semantic: form.get("semantic") === "on",
      headless: form.get("headless") === "on",
      visible: form.get("visible") === "on",
      position: form.get("position"),
    },
    isNew ? "create" : "update",
  );
  return r.ok ? redirect("/admin/plans") : { errors: r.errors };
};

export default function BackofficePlan() {
  const { isNew, plan, shops } = useLoaderData<typeof loader>();
  const errors = (useActionData<typeof action>()?.errors ?? {}) as Record<string, string>;
  const busy = useNavigation().state !== "idle";
  return (
    <s-page heading={isNew ? "Add plan" : `Edit ${plan.name}`} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/admin/plans">
        Plans
      </s-link>
      <Form method="post">
        <s-stack direction="block" gap="base">
          {errors.form && <s-banner tone="critical">{errors.form}</s-banner>}
          <s-section heading="Plan">
            <s-stack direction="block" gap="base">
              <s-text-field
                label="Handle"
                name="id"
                value={plan.id}
                disabled={!isNew}
                required
                error={errors.id}
                details="Must match the plan handle in the Partner Dashboard (Shopify App Pricing). Can't be changed later."
              />
              <s-text-field
                label="Name"
                name="name"
                value={plan.name}
                required
                error={errors.name}
              />
              <s-number-field
                label="Price per month (USD)"
                name="priceUsd"
                value={String(plan.priceUsd)}
                min={0}
                step={0.01}
                error={errors.priceUsd}
                details="For display and MRR estimates only. Shopify charges the price set in the Partner Dashboard."
              />
              <s-number-field
                label="Position"
                name="position"
                value={String(plan.position)}
                min={0}
                error={errors.position}
                details="Lower numbers are listed first."
              />
            </s-stack>
          </s-section>
          <s-section heading="Limits and features">
            <s-stack direction="block" gap="base">
              <s-number-field
                label="Products"
                name="maxProducts"
                value={String(plan.maxProducts)}
                min={1}
                error={errors.maxProducts}
                details="Catalog size this plan is for. Shops over the limit see an upgrade notice."
              />
              <s-number-field
                label="Search API requests per minute"
                name="rpm"
                value={String(plan.rpm)}
                min={10}
                error={errors.rpm}
              />
              <s-checkbox
                label="AI search (match by meaning)"
                name="semantic"
                checked={plan.semantic}
              />
              <s-checkbox label="Headless API access" name="headless" checked={plan.headless} />
              <s-checkbox
                label="Show on the merchant Plans page"
                name="visible"
                checked={plan.visible}
                details="Hide retired plans instead of deleting them; shops already on them keep their features."
              />
            </s-stack>
          </s-section>
          <s-button type="submit" variant="primary" loading={busy}>
            Save plan
          </s-button>
        </s-stack>
      </Form>
      {!isNew && plan.id !== "free" && (
        <Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <s-box paddingBlockStart="base">
            <s-button type="submit" tone="critical" disabled={shops > 0}>
              {shops > 0 ? `Can't delete: ${shops} shops are on this plan` : "Delete plan"}
            </s-button>
          </s-box>
        </Form>
      )}
    </s-page>
  );
}
