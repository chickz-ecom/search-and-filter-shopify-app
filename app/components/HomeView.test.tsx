import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { embedStatusFrom, themeEditorLinks } from "../lib/admin/theme-links";
import { p75 } from "../lib/observability/vitals.server";
import { HomeView, type HomeViewProps } from "./HomeView";

const base: HomeViewProps = {
  locale: "en",
  shopDomain: "s.myshopify.com",
  currency: "USD",
  status: {
    state: "IDLE",
    productCount: 10,
    indexedCount: 10,
    percent: 100,
    phase: null,
    fetched: null,
    lastFullSyncAt: null,
    lastIncrementalAt: null,
    running: null,
    lastError: null,
  },
  kpis: {
    searches: 120,
    zeroResultRate: 0.05,
    clicks: 30,
    ctr: 0.25,
    addToCarts: 4,
    revenue: 321.5,
    previous: { searches: 100, zeroResultRate: 0.1, ctr: 0.2, revenue: 0 },
  },
  onboarding: { dismissed: false, search: "2026-10-26" },
  links: themeEditorLinks("s.myshopify.com", "key123"),
  embed: { embedEnabled: false, searchBlockAdded: true, collectionBlockAdded: false },
  onDismiss: () => undefined,
  onPreview: () => undefined,
};

describe("HomeView (3.1)", () => {
  it("shows the setup checklist with embed status, progress and the next step as primary action", () => {
    const html = renderToStaticMarkup(<HomeView {...base} />);
    expect(html).toContain("2 of 7 tasks complete");
    expect(html).toContain("App embed is off");
    expect(html).toMatch(
      /slot="primary-action"[^>]*href="https:\/\/s\.myshopify\.com\/admin\/themes\/current\/editor\?context=apps/,
    );
    expect(html).toContain("Dismiss guide");
  });

  it("shows KPIs with trends and hides the guide when dismissed", () => {
    const html = renderToStaticMarkup(<HomeView {...base} onboarding={{ dismissed: true }} />);
    expect(html).not.toContain("Setup guide");
    expect(html).toContain("120");
    expect(html).toContain("+20%");
    expect(html).toContain("$321.50");
    expect(html).toContain("Indexed 10 of 10 products");
  });

  it("explains empty analytics in Vietnamese", () => {
    const html = renderToStaticMarkup(
      <HomeView {...base} locale="vi" kpis={{ ...base.kpis, searches: 0 }} />,
    );
    expect(html).toContain("Số liệu tìm kiếm sẽ hiện ở đây");
  });
});

describe("theme links and embed status", () => {
  it("builds deep links", () => {
    const l = themeEditorLinks("s.myshopify.com", "key123");
    expect(l.searchBlock).toBe(
      "https://s.myshopify.com/admin/themes/current/editor?template=search&addAppBlockId=key123/search-results&target=mainSection",
    );
    expect(l.embed).toContain("activateAppId=key123/app-embed");
  });

  it("reads shopify.app.extensions() activations", () => {
    expect(
      embedStatusFrom([
        { type: "ui_extension", activations: [{ target: "admin.x" }] },
        {
          type: "theme_app_extension",
          activations: [
            {
              handle: "app-embed",
              name: "Search & Filter",
              target: "body",
              status: "active",
              activations: [],
            },
            {
              handle: "collection-filter",
              name: "Collection filters",
              target: "section",
              status: "active",
              activations: [
                {
                  target: "template--collection/main",
                  themeId: "gid://shopify/OnlineStoreTheme/1",
                },
              ],
            },
            {
              handle: "search-results",
              name: "Search results",
              target: "section",
              status: "available",
              activations: [],
            },
          ],
        },
      ]),
    ).toEqual({ embedEnabled: true, searchBlockAdded: false, collectionBlockAdded: true });
  });

  it("computes p75", () => {
    expect(p75([1, 2, 3, 4])).toBe(3);
    expect(p75([])).toBeNull();
  });
});
