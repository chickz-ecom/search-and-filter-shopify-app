import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordAdminVitals } from "../lib/observability/vitals.server";

// Nhận Web Vitals của admin (shopify.webVitals.onReport) → Redis, tính p75 ở trang nội bộ / metrics (task 3.10, 6.1).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const metrics = (await request.json().catch(() => [])) as { name: string; value: number }[];
  await recordAdminVitals(session.shop, Array.isArray(metrics) ? metrics.slice(0, 20) : []);
  return new Response(null, { status: 204 });
};
