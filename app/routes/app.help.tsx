import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { HelpView } from "../components/HelpView";
import { adminContext } from "../lib/admin.server";
import { themeEditorLinks } from "../lib/admin/theme-links";
import { env } from "../lib/env.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale } = await adminContext(request, auth);
  const e = env();
  return {
    locale,
    links: themeEditorLinks(shop.domain, e.SHOPIFY_API_KEY, process.env.SHOPIFY_SEARCH_THEME_ID),
    supportEmail: e.SUPPORT_EMAIL,
    docsUrl: e.DEVELOPER_DOCS_URL,
  };
};

export default function HelpPage() {
  return <HelpView {...useLoaderData<typeof loader>()} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
