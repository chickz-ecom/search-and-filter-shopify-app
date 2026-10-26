import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AnalyticsView } from "../components/AnalyticsView";
import { adminContext } from "../lib/admin.server";
import { getAnalyticsReport, parseRange } from "../lib/analytics/report.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, locale, db } = await adminContext(request);
  const range = parseRange(new URL(request.url).searchParams.get("range"));
  return {
    locale,
    currency: shop.currency,
    report: await getAnalyticsReport(db, shop.id, locale, range),
  };
};

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const [, setParams] = useSearchParams();
  return (
    <AnalyticsView
      {...data}
      loading={nav.state === "loading"}
      onRangeChange={(range) => setParams({ range: String(range) })}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
