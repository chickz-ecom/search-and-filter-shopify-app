import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { MerchIndexView } from "../components/MerchViews";
import { adminContext } from "../lib/admin.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, locale, db } = await adminContext(request);
  const where = { shopId: shop.id };
  const [synonyms, redirects, rules, stopwords] = await Promise.all([
    db.synonym.count({ where }),
    db.redirect.count({ where }),
    db.merchRule.count({ where }),
    db.stopWord.count({ where }),
  ]);
  return { locale, counts: { synonyms, redirects, rules, stopwords } };
};

export default function MerchIndex() {
  return <MerchIndexView {...useLoaderData<typeof loader>()} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
