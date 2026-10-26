import type { ActionFunctionArgs } from "react-router";
import { handleWebhookRequest } from "../lib/webhooks/dispatch.server";

// app/uninstalled — xoá session, đánh dấu shop, xếp job dừng/giữ index 48h (mục 5.4).
export const action = ({ request }: ActionFunctionArgs) => handleWebhookRequest(request);
