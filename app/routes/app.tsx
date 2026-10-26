import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { localeFromRequest, translator } from "../i18n";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", locale: localeFromRequest(request) };
};

export default function App() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  const t = translator(locale);

  useEffect(() => {
    // BFS: Admin Web Vitals p75 (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms) — gửi về backend để theo dõi (task 3.10 / 6.1).
    void shopify.webVitals?.onReport?.((report) => {
      const body = JSON.stringify(report.metrics.map((m) => ({ name: m.name, value: m.value })));
      void fetch("/app/vitals", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => undefined);
    });
  }, []);

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app" {...{ rel: "home" }}>
          {t("nav.home")}
        </s-link>
        <s-link href="/app/search">{t("nav.search")}</s-link>
        <s-link href="/app/sorting">{t("nav.sorting")}</s-link>
        <s-link href="/app/filters">{t("nav.filters")}</s-link>
        <s-link href="/app/merchandising">{t("nav.merchandising")}</s-link>
        <s-link href="/app/appearance">{t("nav.appearance")}</s-link>
        <s-link href="/app/analytics">{t("nav.analytics")}</s-link>
        <s-link href="/app/sync">{t("nav.sync")}</s-link>
        <s-link href="/app/developers">{t("nav.developers")}</s-link>
        <s-link href="/app/plans">{t("nav.plans")}</s-link>
        <s-link href="/app/help">{t("nav.help")}</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
