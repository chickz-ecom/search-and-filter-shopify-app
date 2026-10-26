import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { translator, type MessageKey } from "../i18n";
import { adminContext } from "../lib/admin.server";
import { authenticate } from "../shopify.server";
import { enqueueSync } from "../lib/queue/queue.server";
import { SyncView } from "../components/SyncView";
import { syncErrorHint } from "../lib/sync/errors";
import { getSyncStatus } from "../lib/sync/status.server";

// Trang Sync (task 1.11, mục 5.5): trạng thái, lịch sử, Sync now.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, locale, db } = await adminContext(request, auth);
  const [status, jobs] = await Promise.all([
    getSyncStatus(db, shop.id),
    db.syncJob.findMany({ where: { shopId: shop.id }, orderBy: { startedAt: "desc" }, take: 20 }),
  ]);
  return {
    locale,
    status,
    hint: status.lastError ? syncErrorHint(status.lastError.message) : null,
    jobs: jobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      startedAt: j.startedAt.toISOString(),
      durationMs: j.finishedAt ? j.finishedAt.getTime() - j.startedAt.getTime() : null,
      imported: Number((j.stats as { imported?: number })?.imported ?? 0),
      error: j.error,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticate.admin(request);
  const { shop, db } = await adminContext(request, auth);
  const form = await request.formData();
  if (form.get("intent") !== "sync-now")
    return { ok: false as const, message: "sync.alreadyRunning" as MessageKey };
  if (shop.syncState === "RUNNING" || shop.syncState === "QUEUED") {
    return { ok: false as const, message: "sync.alreadyRunning" as MessageKey };
  }
  await db.shop.update({ where: { id: shop.id }, data: { syncState: "QUEUED" } });
  await enqueueSync(
    { type: "full", shopId: shop.id, reason: "manual" },
    { jobId: `full-${shop.id}-${Date.now()}` },
  );
  return { ok: true as const, message: "sync.queued" as MessageKey };
};

export default function SyncPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const t = translator(data.locale);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      shopify.toast.show(t(fetcher.data.message), { isError: !fetcher.data.ok });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <SyncView
      {...data}
      submitting={fetcher.state !== "idle"}
      onSyncNow={() => fetcher.submit({ intent: "sync-now" }, { method: "post" })}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
