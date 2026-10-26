import type { LoaderFunctionArgs } from "react-router";
import { translator, type MessageKey } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { parseDateRange } from "../lib/analytics/range";
import { csvOf, getTable, REPORTS, type ReportKey } from "../lib/analytics/reports.server";
import { getEngine } from "../lib/search";
import { authenticate } from "../shopify.server";

const BOM = String.fromCharCode(0xfeff);

// Resource route (7.3): một báo cáo Analytics dạng CSV cho khoảng ngày trên URL. Không có UI.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale, db } = await adminContext(request, auth);
  const report = params.report as ReportKey;
  if (!REPORTS.includes(report)) throw new Response("Not found", { status: 404 });
  const range = parseDateRange(new URL(request.url).searchParams);
  const table = await getTable(
    { db, engine: getEngine(), shopId: shop.id, currency: shop.currency, locale },
    report,
    range,
  );
  const t = translator(locale);
  const headers = Object.fromEntries(
    table.columns.map((c) => {
      const name = t(`analytics.col.${c.key}` as MessageKey);
      const unit = c.kind === "money" ? ` (${shop.currency})` : c.kind === "percent" ? " (%)" : "";
      return [c.key, name + unit];
    }),
  );
  // BOM để Excel đọc đúng UTF-8 (tiếng Việt, ký tự có dấu).
  return new Response(BOM + csvOf(table, headers), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}_${range.from}_${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
