import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SortingView } from "../components/SortingView";
import { translator } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { cachedMetafieldDefinitions } from "../lib/admin/metafield-defs.server";
import {
  collectionTitles,
  loadSortingForm,
  saveSorting,
  sortDataAvailability,
  type SortingForm,
} from "../lib/admin/sorting.server";
import { redis } from "../lib/redis.server";
import { getEngine } from "../lib/search";
import { adminContextTransport, GraphqlExecutor } from "../lib/shopify/graphql";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, admin, locale, db } = await adminContext(request);
  const [initial, metafieldDefs, availability] = await Promise.all([
    loadSortingForm(db, shop.id),
    cachedMetafieldDefinitions(new GraphqlExecutor(adminContextTransport(admin)), shop.id, redis()),
    sortDataAvailability(getEngine(), shop.id),
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
  };
};

type ActionData = { ok: true; reindex: boolean } | { ok: false; errors: Record<string, string> };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { shop, db } = await adminContext(request);
  return saveSorting(db, shop, await request.json());
};

export default function SortingPage() {
  const data = useLoaderData<typeof loader>();
  const save = useFetcher<ActionData>();
  const t = translator(data.locale);

  useEffect(() => {
    if (save.state !== "idle" || !save.data) return;
    if (save.data.ok)
      shopify.toast.show(save.data.reindex ? t("common.reindexQueued") : t("common.saved"));
    else shopify.toast.show(t("common.errorSaving"), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.state, save.data]);

  return (
    <SortingView
      {...data}
      saving={save.state !== "idle"}
      errors={save.data && !save.data.ok ? save.data.errors : {}}
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
