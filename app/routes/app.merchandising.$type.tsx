import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { MerchListView } from "../components/MerchViews";
import { translator } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { authenticate } from "../shopify.server";
import {
  listMerch,
  MERCH_TYPES,
  mutateMerch,
  type MerchMutation,
  type MerchType,
} from "../lib/admin/merch.server";
import type { MerchActions, MerchCondition } from "../lib/merch/engine-sync.server";
import { getEngine } from "../lib/search";
import { contentAlias, productAlias } from "../lib/search/names";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const type = params.type as MerchType;
  if (!MERCH_TYPES.includes(type)) throw new Response("Not found", { status: 404 });
  const auth = await authenticate.admin(request);
  const { shop, locale, db } = await adminContext(request, auth);
  const lists = await listMerch(db, shop.id);
  // Tên sản phẩm/collection trong rule (index của shop).
  const names: Record<string, string> = {};
  const engine = getEngine();
  await Promise.all(
    lists.rules.flatMap((r) => {
      const a = r.actions as MerchActions;
      const c = r.condition as MerchCondition;
      const ids = [...(a.pin ?? []).map((x) => x.productId), ...(a.hide ?? [])];
      return [
        ...ids.map(async (id) => {
          const d = await engine
            .getDocument<{ title: string }>(productAlias(shop.id), id)
            .catch(() => null);
          if (d) names[id] = d.title;
        }),
        ...(c.collectionId
          ? [
              (async () => {
                const d = await engine
                  .getDocument<{ title: string }>(
                    contentAlias(shop.id),
                    `collection-${c.collectionId}`,
                  )
                  .catch(() => null);
                if (d) names[c.collectionId!] = d.title;
              })(),
            ]
          : []),
      ];
    }),
  );
  return {
    locale,
    type,
    lists,
    names,
    prefill: new URL(request.url).searchParams.get("new") ?? undefined,
  };
};

type ActionData = { ok: true } | { ok: false; errors: Record<string, string> };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const auth = await authenticate.admin(request);
  const { shop, db } = await adminContext(request, auth);
  return mutateMerch(db, shop, (await request.json()) as MerchMutation);
};

export default function MerchTypePage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const t = translator(data.locale);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show(t("common.saved"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <MerchListView
      {...data}
      busy={fetcher.state !== "idle"}
      errors={fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {}}
      saved={fetcher.state === "idle" && fetcher.data?.ok ? fetcher.data : null}
      onMutate={(m) => fetcher.submit(m as never, { method: "post", encType: "application/json" })}
      onPickProducts={async () => {
        const picked = await shopify.resourcePicker({
          type: "product",
          action: "select",
          multiple: true,
        });
        return (picked ?? []).map((p) => ({ id: String(p.id).split("/").pop()!, title: p.title }));
      }}
      onPickCollection={async () => {
        const picked = await shopify.resourcePicker({
          type: "collection",
          action: "select",
          multiple: false,
        });
        const c = picked?.[0];
        return c ? { id: String(c.id).split("/").pop()!, title: c.title } : null;
      }}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
