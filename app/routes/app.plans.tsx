import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { PlansView } from "../components/PlansView";
import { adminContext } from "../lib/admin.server";
import { authenticate } from "../shopify.server";
import { planForProductCount, PLANS } from "../lib/billing/plans";
import {
  planSelectionUrl,
  refreshPlan,
  type SubscriptionInfo,
} from "../lib/billing/subscription.server";

// Cũng là welcome link của các gói (Partner Dashboard → /app/plans; Shopify nối ?plan_handle=…): mỗi lần mở trang
// đối chiếu lại gói với Partner API.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale, db } = await adminContext(request, auth);
  let subscription: SubscriptionInfo;
  let checkFailed = false;
  try {
    subscription = await refreshPlan(db, shop);
  } catch (e) {
    console.warn("[plans] refresh failed", (e as Error).message);
    checkFailed = true;
    subscription = {
      planId: PLANS.find((p) => p.id === shop.plan)?.id ?? "free",
      source: "local",
      billingPeriod: null,
      renewsAt: null,
      trialEndsAt: null,
      cancelAtEndOfCycle: false,
      pendingPlanId: null,
    };
  }
  return {
    locale,
    plans: PLANS,
    subscription,
    productCount: shop.productCount,
    recommended: planForProductCount(shop.productCount).id,
    selectionUrl: planSelectionUrl(shop.domain),
    checkFailed,
  };
};

export default function PlansPage() {
  return <PlansView {...useLoaderData<typeof loader>()} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
