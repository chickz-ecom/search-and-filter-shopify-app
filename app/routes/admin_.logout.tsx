import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { endSession } from "../lib/backoffice/auth.server";

// Back-office (8.2): đăng xuất (POST để không bị kích hoạt bởi link/ảnh từ trang khác).
export const action = async ({ request }: ActionFunctionArgs) =>
  redirect("/admin/login", { headers: { "Set-Cookie": await endSession(request) } });

export const loader = () => redirect("/admin");
