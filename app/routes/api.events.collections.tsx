import type { ActionFunctionArgs } from "react-router";
import { handleWebhookRequest } from "../lib/webhooks/dispatch.server";

// Events API: Collection (collection.products, collection.sortOrder) — D8. Cùng HMAC với webhook.
export const action = ({ request }: ActionFunctionArgs) => handleWebhookRequest(request);
