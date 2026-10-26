import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AnalyticsShell, type AnalyticsSection } from "../components/analytics/AnalyticsShell";
import { adminContext } from "../lib/admin.server";
import { parseDateRange, rangeQuery } from "../lib/analytics/range";
import { authenticate } from "../shopify.server";

// Analytics v2 (7.3): khung chung — điều hướng Overview / Search / Collections / Export + khoảng ngày trên URL.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale } = await adminContext(request, auth);
  return {
    locale,
    currency: shop.currency,
    range: parseDateRange(new URL(request.url).searchParams),
  };
};

export default function AnalyticsLayout() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const sub = location.pathname.split("/")[3];
  const active: AnalyticsSection =
    sub === "search" || sub === "collections" || sub === "export" ? sub : "overview";

  return (
    <AnalyticsShell
      locale={data.locale}
      currency={data.currency}
      range={data.range}
      active={active}
      onNavigate={(s) =>
        navigate(`/app/analytics${s === "overview" ? "" : `/${s}`}?${rangeQuery(data.range)}`)
      }
      onRange={(r) => {
        const params = new URLSearchParams(location.search);
        params.set("from", r.from);
        params.set("to", r.to);
        params.delete("page");
        navigate(`${location.pathname}?${params}`);
      }}
    >
      <Outlet />
    </AnalyticsShell>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
