import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { OverviewView } from "../components/analytics/OverviewView";
import { adminContext } from "../lib/admin.server";
import { parseDateRange } from "../lib/analytics/range";
import { getOverview } from "../lib/analytics/reports.server";
import { getEngine } from "../lib/search";
import { authenticate } from "../shopify.server";

// Analytics → Overview (7.3).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale, db } = await adminContext(request, auth);
  const range = parseDateRange(new URL(request.url).searchParams);
  const overview = await getOverview(
    { db, engine: getEngine(), shopId: shop.id, currency: shop.currency, locale },
    range,
  );
  return { locale, currency: shop.currency, overview };
};

export default function AnalyticsOverview() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return <OverviewView {...data} loading={nav.state === "loading"} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
