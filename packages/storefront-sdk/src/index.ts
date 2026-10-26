import { createPricer } from "./storefront-pricing";
import { autoMount, createSDK } from "./sdk";
import type { SearchAppContext, SearchAppSDK } from "./types";

// Entry window.SearchApp (app embed nạp asset này). Hợp đồng công khai: ./types.ts (SDK v1).
export type * from "./types";

declare global {
  interface Window {
    SearchApp?: SearchAppSDK;
    SearchAppContext?: SearchAppContext;
  }
}

function readContext(): SearchAppContext | null {
  if (window.SearchAppContext) return window.SearchAppContext;
  const el = document.getElementById("searchapp-config");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as SearchAppContext;
  } catch {
    return null;
  }
}

(function boot() {
  // App embed có thể đặt stub { ready() } (nạp SDK lười) → chỉ bỏ qua khi SDK thật đã có.
  if (typeof window === "undefined" || window.SearchApp?.version) return;

  const ctx = readContext();
  if (!ctx) return;
  const sdk = createSDK(ctx, { pricer: createPricer(ctx) });
  window.SearchApp = sdk;
  const start = () => {
    document.dispatchEvent(new CustomEvent("searchapp:ready", { detail: sdk }));
    autoMount(sdk);
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
