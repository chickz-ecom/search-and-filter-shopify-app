import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SearchView } from "../components/SearchView";
import { translator } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { authenticate } from "../shopify.server";
import { cachedMetafieldDefinitions } from "../lib/admin/metafield-defs.server";
import { saveSearchSettings, zodErrors } from "../lib/admin/search-settings.server";
import { SearchSettingsSchema, type SearchSettingsConfig } from "../lib/config/search-settings";
import { redis } from "../lib/redis.server";
import { getEngine } from "../lib/search";
import { buildShopContext } from "../lib/search-service/context.server";
import { previewSearch, type PreviewResult } from "../lib/search-service/preview.server";
import { loadShopConfig, shopFeatures } from "../lib/shop/shop.server";
import { CONTENT_SCOPES } from "../lib/sync/content-scopes";
import { semanticAllowed } from "../lib/billing/plans";
import { adminContextTransport, GraphqlExecutor } from "../lib/shopify/graphql";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, admin, session, locale, db } = await adminContext(request, auth);
  const [config, metafieldDefs] = await Promise.all([
    loadShopConfig(db, shop.id),
    cachedMetafieldDefinitions(new GraphqlExecutor(adminContextTransport(admin)), shop.id, redis()),
  ]);
  return {
    locale,
    currency: shop.currency,
    initial: config.settings,
    metafieldDefs,
    hasContentScope: CONTENT_SCOPES.every((sc) => (session.scope ?? "").split(",").includes(sc)),
    semanticEntitled: semanticAllowed(shop.plan, shopFeatures(shop)),
  };
};

type ActionData =
  | { intent: "save"; ok: true; reindex: boolean }
  | { intent: "save"; ok: false; errors: Record<string, string> }
  | { intent: "preview"; ok: true; result: PreviewResult }
  | { intent: "preview"; ok: false; errors: Record<string, string> };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const auth = await authenticate.admin(request);
  const { shop, db } = await adminContext(request, auth);
  const body = (await request.json()) as {
    intent: "save" | "preview";
    settings: unknown;
    q?: string;
  };
  if (body.intent === "preview") {
    const parsed = SearchSettingsSchema.safeParse(body.settings);
    if (!parsed.success)
      return { intent: "preview", ok: false, errors: zodErrors(parsed.error.issues) };
    const ctx = await buildShopContext(db, getEngine(), shop);
    return {
      intent: "preview",
      ok: true,
      result: await previewSearch(
        ctx,
        parsed.data,
        String(body.q ?? "").slice(0, 200),
        getEngine(),
      ),
    };
  }
  const r = await saveSearchSettings(db, shop, body.settings);
  return r.ok
    ? { intent: "save", ok: true, reindex: r.reindex }
    : { intent: "save", ok: false, errors: r.errors };
};

export default function SearchPage() {
  const data = useLoaderData<typeof loader>();
  const save = useFetcher<ActionData>();
  const preview = useFetcher<ActionData>();
  const t = translator(data.locale);

  useEffect(() => {
    if (save.state !== "idle" || !save.data || save.data.intent !== "save") return;
    if (save.data.ok)
      shopify.toast.show(save.data.reindex ? t("common.reindexQueued") : t("common.saved"));
    else shopify.toast.show(t("common.errorSaving"), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.state, save.data]);

  const errors = save.data && !save.data.ok ? save.data.errors : {};
  const previewResult =
    preview.data?.intent === "preview" && preview.data.ok ? preview.data.result : null;

  const onSave = async (settings: SearchSettingsConfig) => {
    const wantsContent = (["pages", "articles"] as const).some(
      (k) => settings.searchTypes[k].autocomplete || settings.searchTypes[k].results,
    );
    if (wantsContent && !data.hasContentScope) {
      // Scope tuỳ chọn (shopify.app.toml optional_scopes) — chỉ xin khi merchant bật tìm trang/bài viết.
      await shopify.scopes?.request(CONTENT_SCOPES).catch(() => undefined);
    }
    save.submit({ intent: "save", settings } as never, {
      method: "post",
      encType: "application/json",
    });
  };

  return (
    <SearchView
      locale={data.locale}
      initial={data.initial}
      metafieldDefs={data.metafieldDefs}
      currency={data.currency}
      saving={save.state !== "idle"}
      errors={errors}
      preview={previewResult}
      previewing={preview.state !== "idle"}
      onSave={onSave}
      onPreview={(settings, q) =>
        preview.submit({ intent: "preview", settings, q } as never, {
          method: "post",
          encType: "application/json",
        })
      }
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
