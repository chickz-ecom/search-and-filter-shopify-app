import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { getShopByDomain } from "../lib/shop/shop.server";
import { getSyncStatus } from "../lib/sync/status.server";
import { authenticate } from "../shopify.server";

// Home tạm (task 1.5: tiến độ "Đang index x/y"). Task 3.1 dựng Home đầy đủ (checklist, embed, KPI).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getShopByDomain(prisma, session.shop);
  return { status: shop ? await getSyncStatus(prisma, shop.id) : null };
};

export default function Index() {
  const { status } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Search & Filter">
      <s-section heading="Sync">
        {status ? (
          <s-paragraph>
            {status.state === "RUNNING" || status.state === "QUEUED"
              ? `Indexing: ${status.indexedCount}/${status.productCount}`
              : `Indexed ${status.indexedCount} of ${status.productCount} products`}
          </s-paragraph>
        ) : (
          <s-paragraph>Setting up…</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
