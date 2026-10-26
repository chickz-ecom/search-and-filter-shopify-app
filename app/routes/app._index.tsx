import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import type { Prisma } from "@prisma/client";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { HomeView, type OnboardingState } from "../components/HomeView";
import { adminContext } from "../lib/admin.server";
import { authenticate } from "../shopify.server";
import { embedStatusFrom, themeEditorLinks, type EmbedStatus } from "../lib/admin/theme-links";
import { getKpis } from "../lib/analytics/kpi.server";
import { getSyncStatus } from "../lib/sync/status.server";

// Home (task 3.1): checklist + trạng thái embed (shopify.app.extensions()) + card sync + KPI 7 ngày.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale, db } = await adminContext(request, auth);
  const [status, kpis] = await Promise.all([getSyncStatus(db, shop.id), getKpis(db, shop.id)]);
  const onboarding: OnboardingState = {
    ...(shop.onboarding as Record<string, string>),
    dismissed: shop.onboardingDismissed,
  };
  return {
    locale,
    shopDomain: shop.domain,
    currency: shop.currency,
    status,
    kpis,
    onboarding,
    links: themeEditorLinks(
      shop.domain,
      process.env.SHOPIFY_API_KEY ?? "",
      process.env.SHOPIFY_SEARCH_THEME_ID,
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, db } = await adminContext(request, auth);
  const intent = (await request.formData()).get("intent");
  if (intent === "dismiss")
    await db.shop.update({ where: { id: shop.id }, data: { onboardingDismissed: true } });
  if (intent === "preview") {
    const onboarding = {
      ...(shop.onboarding as Record<string, string>),
      preview: new Date().toISOString(),
    };
    await db.shop.update({
      where: { id: shop.id },
      data: { onboarding: onboarding as Prisma.InputJsonValue },
    });
  }
  return { ok: true };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [embed, setEmbed] = useState<EmbedStatus | null>(null);

  useEffect(() => {
    // Chỉ phản ánh theme đang publish; không cần scope (docs/shopify-api/storefront-apphome.md mục 7).
    shopify.app
      .extensions()
      .then((exts) =>
        setEmbed(embedStatusFrom(exts as unknown as { type: string; activations: unknown }[])),
      )
      .catch(() =>
        setEmbed({ embedEnabled: false, searchBlockAdded: false, collectionBlockAdded: false }),
      );
  }, []);

  return (
    <HomeView
      {...data}
      embed={embed}
      onDismiss={() => fetcher.submit({ intent: "dismiss" }, { method: "post" })}
      onPreview={() => fetcher.submit({ intent: "preview" }, { method: "post" })}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
