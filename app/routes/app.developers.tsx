import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { DevelopersView } from "../components/DevelopersView";
import { translator } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { authenticate } from "../shopify.server";
import { developersInfo, saveDevelopers } from "../lib/admin/developers.server";
import { env } from "../lib/env.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale } = await adminContext(request, auth);
  const e = env();
  return { locale, info: developersInfo(shop, e.SEARCH_API_PUBLIC_URL, e.DEVELOPER_DOCS_URL) };
};

type ActionData = { ok: true } | { ok: false; errors: Record<string, string> };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const auth = await authenticate.admin(request);
  const { shop, db } = await adminContext(request, auth);
  return saveDevelopers(db, shop, await request.json());
};

export default function DevelopersPage() {
  const data = useLoaderData<typeof loader>();
  const save = useFetcher<ActionData>();
  const t = translator(data.locale);

  useEffect(() => {
    if (save.state !== "idle" || !save.data) return;
    if (save.data.ok) shopify.toast.show(t("common.saved"));
    else shopify.toast.show(t("common.errorSaving"), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.state, save.data]);

  return (
    <DevelopersView
      {...data}
      saving={save.state !== "idle"}
      errors={save.data && !save.data.ok ? save.data.errors : {}}
      onSave={(form) => save.submit(form, { method: "post", encType: "application/json" })}
      onCopy={(text) => {
        void navigator.clipboard.writeText(text).then(() => shopify.toast.show(t("dev.copied")));
      }}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
