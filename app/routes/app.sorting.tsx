import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SortingView } from "../components/SortingView";
import { translator } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { authenticate } from "../shopify.server";
import { cachedMetafieldDefinitions } from "../lib/admin/metafield-defs.server";
import {
  collectionTitles,
  loadSortingForm,
  saveSorting,
  sortDataAvailability,
  type SortingForm,
} from "../lib/admin/sorting.server";
import { bestSellingInfo, changeBestSelling } from "../lib/admin/best-selling.server";
import { redis } from "../lib/redis.server";
import { getEngine } from "../lib/search";
import { adminContextTransport, GraphqlExecutor } from "../lib/shopify/graphql";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, admin, locale, db } = await adminContext(request, auth);
  const [initial, metafieldDefs, availability, bestSelling] = await Promise.all([
    loadSortingForm(db, shop.id),
    cachedMetafieldDefinitions(new GraphqlExecutor(adminContextTransport(admin)), shop.id, redis()),
    sortDataAvailability(getEngine(), shop.id),
    bestSellingInfo(db, shop.id),
  ]);
  const titles = await collectionTitles(
    getEngine(),
    shop.id,
    initial.overrides.map((o) => o.collectionId),
  );
  return {
    locale,
    locales: shop.locales,
    initial,
    metafieldDefs,
    availability,
    collectionTitles: titles,
    bestSelling,
  };
};

type ActionData =
  | { ok: true; reindex: boolean }
  | { ok: false; errors: Record<string, string> }
  | { intent: "best-selling"; ok: boolean; changed?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const auth = await authenticate.admin(request);
  const { shop, db, admin } = await adminContext(request, auth);
  const body = (await request.json()) as { intent?: string };
  if (body.intent === "best-selling") {
    const r = await changeBestSelling(
      db,
      shop.id,
      new GraphqlExecutor(adminContextTransport(admin)),
      body,
      {
        appUrl: process.env.SHOPIFY_APP_URL ?? "",
      },
    );
    return { intent: "best-selling", ok: r.ok, changed: r.ok ? r.changed : undefined };
  }
  return saveSorting(db, shop, body);
};

export default function SortingPage() {
  const data = useLoaderData<typeof loader>();
  const save = useFetcher<ActionData>();
  const bs = useFetcher<ActionData>();
  const t = translator(data.locale);

  useEffect(() => {
    if (save.state !== "idle" || !save.data) return;
    if (save.data.ok && "reindex" in save.data)
      shopify.toast.show(save.data.reindex ? t("common.reindexQueued") : t("common.saved"));
    else if (!save.data.ok) shopify.toast.show(t("common.errorSaving"), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.state, save.data]);

  useEffect(() => {
    if (bs.state !== "idle" || !bs.data || !("intent" in bs.data)) return;
    if (!bs.data.ok) shopify.toast.show(t("sorting.bs.denied"), { isError: true });
    else if (bs.data.changed === "enabled") shopify.toast.show(t("sorting.bs.enabled"));
    else if (bs.data.changed === "disabled") {
      shopify.toast.show(t("sorting.bs.disabled"));
      // Gỡ quyền SAU khi server đã xoá webhook + dữ liệu đơn (cần quyền để xoá subscription).
      void shopify.scopes?.revoke(["read_orders"]).catch(() => undefined);
    } else if (bs.data.changed === "metric") shopify.toast.show(t("common.saved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bs.state, bs.data]);

  return (
    <SortingView
      {...data}
      saving={save.state !== "idle"}
      errors={save.data && !save.data.ok && "errors" in save.data ? save.data.errors : {}}
      busy={bs.state !== "idle"}
      onBestSelling={async (next) => {
        if (next.source === "orders" && data.bestSelling.source !== "orders") {
          // Optional scope (D17): hỏi merchant trước; từ chối → giữ nguồn Shopify.
          const r = await shopify.scopes?.request(["read_orders"]).catch(() => null);
          if (!r || r.result !== "granted-all")
            return shopify.toast.show(t("sorting.bs.denied"), { isError: true });
        }
        bs.submit(
          { intent: "best-selling", ...next },
          { method: "post", encType: "application/json" },
        );
      }}
      onSave={(form: SortingForm) =>
        save.submit(form as never, { method: "post", encType: "application/json" })
      }
      onPickCollections={async () => {
        const picked = await shopify.resourcePicker({
          type: "collection",
          action: "select",
          multiple: true,
        });
        return (picked ?? []).map((c) => ({ id: String(c.id).split("/").pop()!, title: c.title }));
      }}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
