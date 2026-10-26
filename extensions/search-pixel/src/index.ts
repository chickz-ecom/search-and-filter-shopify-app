import { register } from "@shopify/web-pixels-extension";
import { createPixelHandlers, type PixelEvent, type PixelSettings } from "./handlers";

register(({ analytics, browser, settings, init }) => {
  const shopCurrency = init.data?.shop?.paymentSettings?.currencyCode ?? "USD";
  const handle = createPixelHandlers(
    settings as unknown as PixelSettings,
    browser.sessionStorage,
    (url, body) => {
      // browser.sendBeacon đã deprecated trong Web Pixels API → fetch keepalive (có sẵn trong sandbox strict).
      void fetch(url, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "Content-Type": "text/plain" },
      }).catch(() => undefined);
    },

    shopCurrency,
  );
  for (const name of [
    "search_submitted",
    "collection_viewed",
    "product_added_to_cart",
    "checkout_completed",
  ] as const) {
    analytics.subscribe(
      name,
      (event) => void handle({ name, data: event.data } as unknown as PixelEvent),
    );
  }
});
