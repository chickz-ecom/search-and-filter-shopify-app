import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ReportView } from "../components/analytics/ReportView";
import { useReportNav } from "../components/analytics/useReportNav";
import { translator, type MessageKey } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { reportPage, type ReportKey } from "../lib/analytics/reports.server";
import { getEngine } from "../lib/search";
import { authenticate } from "../shopify.server";

// Analytics → Collections (7.3): Collections, Filters, Filter values, Filter value combinations (trang collection).
const TABS: Record<string, ReportKey> = {
  collections: "collections",
  filters: "collection-filters",
  filterValues: "collection-filter-values",
  combos: "collection-filter-combos",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale, db } = await adminContext(request, auth);
  const page = await reportPage(
    { db, engine: getEngine(), shopId: shop.id, currency: shop.currency, locale },
    new URL(request.url),
    TABS,
  );
  return { locale, currency: shop.currency, ...page };
};

export default function AnalyticsCollections() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const reportNav = useReportNav();
  const t = translator(data.locale);
  return (
    <ReportView
      locale={data.locale}
      currency={data.currency}
      description={t("analytics.collections.desc")}
      tabs={Object.keys(TABS).map((key) => ({
        key,
        label: t(`analytics.tab.${key}` as MessageKey),
      }))}
      activeTab={data.tab}
      table={data.table}
      q={data.q}
      loading={nav.state === "loading"}
      {...reportNav}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
