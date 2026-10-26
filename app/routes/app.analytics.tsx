import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AnalyticsView } from "../components/AnalyticsView";
import { translator } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { mutateMerch } from "../lib/admin/merch.server";
import { getAnalyticsReport, parseRange } from "../lib/analytics/report.server";
import {
  dismissSuggestion,
  suggestSynonyms,
  type SynonymSuggestion,
} from "../lib/merch/synonym-suggestions.server";
import { redis } from "../lib/redis.server";
import { getEngine } from "../lib/search";
import { buildShopContext } from "../lib/search-service/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, locale, db } = await adminContext(request);
  const range = parseRange(new URL(request.url).searchParams.get("range"));
  const engine = getEngine();
  // Gợi ý synonym (5.3) phụ thuộc engine: lỗi → trang vẫn hiện báo cáo.
  const suggestions = await buildShopContext(db, engine, shop)
    .then((ctx) => suggestSynonyms(db, ctx, engine, { redis: redis() }))
    .catch((): SynonymSuggestion[] => []);
  return {
    locale,
    currency: shop.currency,
    report: await getAnalyticsReport(db, shop.id, locale, range),
    suggestions,
  };
};

type ActionData = { ok: boolean; intent: "approve" | "dismiss" };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { shop, db } = await adminContext(request);
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

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const [, setParams] = useSearchParams();
  const act = useFetcher<ActionData>();
  const t = translator(data.locale);

  useEffect(() => {
    if (act.state !== "idle" || !act.data) return;
    if (!act.data.ok) shopify.toast.show(t("common.errorSaving"), { isError: true });
    else if (act.data.intent === "approve") shopify.toast.show(t("analytics.suggest.approved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act.state, act.data]);

  return (
    <AnalyticsView
      {...data}
      loading={nav.state === "loading"}
      busy={act.state !== "idle"}
      onRangeChange={(range) => setParams({ range: String(range) })}
      onSuggestion={(intent, s) =>
        act.submit(
          { intent, query: s.query, term: s.term },
          { method: "post", encType: "application/json" },
        )
      }
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
