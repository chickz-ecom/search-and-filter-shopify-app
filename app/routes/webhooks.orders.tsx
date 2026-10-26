import type { ActionFunctionArgs } from "react-router";
import { handleWebhookRequest } from "../lib/webhooks/dispatch.server";

// orders/create|updated|cancelled (task 2.15) — đăng ký theo shop khi merchant bật xếp hạng theo đơn. Chỉ xác thực +
// enqueue id đơn; payload (có thông tin khách) không được lưu.
export const action = ({ request }: ActionFunctionArgs) => handleWebhookRequest(request);
