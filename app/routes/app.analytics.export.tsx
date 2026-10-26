import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ExportView } from "../components/analytics/ExportView";
import { translator } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { parseDateRange, rangeQuery } from "../lib/analytics/range";
import type { ReportKey } from "../lib/analytics/report-types";
import { authenticate } from "../shopify.server";

// Analytics → Export (7.3): tải CSV qua route app.analytics.csv.$report (fetch kèm session token của App Bridge).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { locale } = await adminContext(request, auth);
  return { locale };
};

export default function AnalyticsExport() {
  const { locale } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const [downloading, setDownloading] = useState<ReportKey | null>(null);
  const t = translator(locale);

  const download = async (report: ReportKey) => {
    const range = parseDateRange(params);
    setDownloading(report);
    try {
      const res = await fetch(`/app/analytics/csv/${report}?${rangeQuery(range)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report}_${range.from}_${range.to}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      shopify.toast.show(t("analytics.export.failed"), { isError: true });
    } finally {
      setDownloading(null);
    }
  };

  return <ExportView locale={locale} downloading={downloading} onDownload={download} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
