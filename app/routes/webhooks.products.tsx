import type { ActionFunctionArgs } from "react-router";
import { handleWebhookRequest } from "../lib/webhooks/dispatch.server";

// products/create|update|delete — chỉ xác thực + enqueue (D7).
export const action = ({ request }: ActionFunctionArgs) => handleWebhookRequest(request);
