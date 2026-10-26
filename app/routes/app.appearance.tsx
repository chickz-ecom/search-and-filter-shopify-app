import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppearanceView } from "../components/AppearanceView";
import { translator } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { loadAppearance, saveAppearance } from "../lib/admin/appearance.server";
import type { AppearanceConfig } from "../lib/config/appearance";
import widgetCss from "../../extensions/search-theme/assets/searchapp.css?raw";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, locale, db } = await adminContext(request);
  return {
    locale,
    locales: shop.locales,
    currency: shop.currency,
    css: widgetCss,
    initial: await loadAppearance(db, shop.id),
  };
};

type ActionData = { ok: true } | { ok: false; errors: Record<string, string> };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { shop, db } = await adminContext(request);
  return saveAppearance(db, shop, await request.json());
};

export default function AppearancePage() {
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
    <AppearanceView
      {...data}
      saving={save.state !== "idle"}
      errors={save.data && !save.data.ok ? save.data.errors : {}}
      onSave={(cfg: AppearanceConfig) =>
        save.submit(cfg as never, { method: "post", encType: "application/json" })
      }
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
