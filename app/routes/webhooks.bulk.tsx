import type { ActionFunctionArgs } from "react-router";
import { handleWebhookRequest } from "../lib/webhooks/dispatch.server";

// bulk_operations/finish → đánh thức BulkRunner — chỉ xác thực + enqueue (D7).
export const action = ({ request }: ActionFunctionArgs) => handleWebhookRequest(request);
