import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigation } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ReportView } from "../components/analytics/ReportView";
import { SynonymSuggestions } from "../components/analytics/SynonymSuggestions";
import { useReportNav } from "../components/analytics/useReportNav";
import { translator, type MessageKey } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { mutateMerch } from "../lib/admin/merch.server";
import { reportPage, type ReportKey } from "../lib/analytics/reports.server";
import {
  dismissSuggestion,
  suggestSynonyms,
  type SynonymSuggestion,
} from "../lib/merch/synonym-suggestions.server";
import { redis } from "../lib/redis.server";
import { getEngine } from "../lib/search";
import { buildShopContext } from "../lib/search-service/context.server";
import { authenticate } from "../shopify.server";

// Analytics → Search (7.3): Queries, 0 results (+ gợi ý synonym), Suggestions, Product performance, Filters,
// Filter values, Filter value combinations, Sorting.
const TABS: Record<string, ReportKey> = {
  queries: "search-queries",
  zero: "search-zero",
  suggestions: "search-suggestions",
  products: "search-products",
  filters: "search-filters",
  filterValues: "search-filter-values",
  combos: "search-filter-combos",
  sorts: "search-sorts",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale, db } = await adminContext(request, auth);
  const engine = getEngine();
  const page = await reportPage(
    { db, engine, shopId: shop.id, currency: shop.currency, locale },
    new URL(request.url),
    TABS,
  );
  // Gợi ý synonym (5.3) phụ thuộc engine: lỗi → báo cáo vẫn hiện.
  const suggestions =
    page.tab === "zero"
      ? await buildShopContext(db, engine, shop)
          .then((ctx) => suggestSynonyms(db, ctx, engine, { redis: redis() }))
          .catch((): SynonymSuggestion[] => [])
      : [];
  return { locale, currency: shop.currency, ...page, suggestions };
};

type ActionData = { ok: boolean; intent: "approve" | "dismiss" };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const auth = await authenticate.admin(request);
  const { shop, db } = await adminContext(request, auth);
  const body = (await request.json()) as {
    intent: "approve" | "dismiss";
    query: string;
    term?: string;
  };
  if (body.intent === "dismiss") {
    await dismissSuggestion(redis(), shop.id, body.query);
    return { ok: true, intent: "dismiss" };
  }
  const r = await mutateMerch(db, shop, {
    op: "upsert",
    type: "synonyms",
    data: { type: "one_way", root: body.query, terms: [body.term ?? ""] },
  });
  return { ok: r.ok, intent: "approve" };
};

const merchLink = (type: "synonyms" | "redirects", q: string) =>
  `/app/merchandising/${type}?new=${encodeURIComponent(q)}`;

export default function AnalyticsSearch() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const act = useFetcher<ActionData>();
  const reportNav = useReportNav();
  const t = translator(data.locale);

  useEffect(() => {
    if (act.state !== "idle" || !act.data) return;
    if (!act.data.ok) shopify.toast.show(t("common.errorSaving"), { isError: true });
    else if (act.data.intent === "approve") shopify.toast.show(t("analytics.suggest.approved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act.state, act.data]);

  return (
    <ReportView
      locale={data.locale}
      currency={data.currency}
      description={t("analytics.search.desc")}
      tabs={Object.keys(TABS).map((key) => ({
        key,
        label: t(`analytics.tab.${key}` as MessageKey),
      }))}
      activeTab={data.tab}
      table={data.table}
      q={data.q}
      loading={nav.state === "loading"}
      {...reportNav}
      before={
        data.tab === "zero" ? (
          <SynonymSuggestions
            locale={data.locale}
            suggestions={data.suggestions}
            busy={act.state !== "idle"}
            onSuggestion={(intent, s) =>
              act.submit(
                { intent, query: s.query, term: s.term },
                { method: "post", encType: "application/json" },
              )
            }
          />
        ) : undefined
      }
      rowActions={
        data.tab === "zero"
          ? (row) => (
              <s-button-group>
                <s-button slot="secondary-actions" href={merchLink("synonyms", String(row.query))}>
                  {t("analytics.addSynonym")}
                </s-button>
                <s-button slot="secondary-actions" href={merchLink("redirects", String(row.query))}>
                  {t("analytics.addRedirect")}
                </s-button>
              </s-button-group>
            )
          : undefined
      }
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
