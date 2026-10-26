import type { ActionFunctionArgs } from "react-router";
import { handleWebhookRequest } from "../lib/webhooks/dispatch.server";

// customers/data_request, customers/redact, shop/redact — HMAC sai trả 401 (BFS).
export const action = ({ request }: ActionFunctionArgs) => handleWebhookRequest(request);
