import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnalyticsReport } from "../lib/analytics/report.server";
import { AnalyticsView, type AnalyticsViewProps } from "./AnalyticsView";

const report: AnalyticsReport = {
  range: 30,
  kpis: {
    searches: 1200,
    zeroResultRate: 0.05,
    clicks: 300,
    ctr: 0.25,
    addToCarts: 40,
    revenue: 980.5,
    previous: { searches: 1000, zeroResultRate: 0.1, ctr: 0.2, revenue: 500 },
  },
  topQueries: [{ query: "tee", searches: 300, clicks: 90, ctr: 0.3, addToCarts: 12, revenue: 240 }],
  zeroResults: [{ query: "sneekers & co", searches: 9, zeroResults: 9 }],
  filterUsage: [{ key: "filter.p.vendor", label: "Brand", value: "Acme", count: 8, share: 0.8 }],
  sortUsage: [{ key: "price_asc", label: "Price, low to high", value: "", count: 3, share: 1 }],
};
const base: AnalyticsViewProps = {
  locale: "en",
  currency: "USD",
  report,
  loading: false,
  onRangeChange: () => undefined,
};

describe("AnalyticsView (3.7)", () => {
  it("shows KPIs for the selected range with a comparison", () => {
    const html = renderToStaticMarkup(<AnalyticsView {...base} />);
    expect(html).toMatch(/<s-select[^>]*label="Date range"[^>]*value="30"/);
    expect(html).toContain("1,200");
    expect(html).toContain("+20% vs previous 30 days");
    expect(html).toContain("$980.50");
  });

  it("offers quick synonym/redirect creation for no-result searches", () => {
    const html = renderToStaticMarkup(<AnalyticsView {...base} />);
    expect(html).toContain('href="/app/merchandising/synonyms?new=sneekers%20%26%20co"');
    expect(html).toContain('href="/app/merchandising/redirects?new=sneekers%20%26%20co"');
  });

  it("lists top searches, filter usage and sort usage", () => {
    const html = renderToStaticMarkup(<AnalyticsView {...base} />);
    expect(html).toContain("Top searches");
    expect(html).toContain("Brand: Acme");
    expect(html).toContain("80.0%");
    expect(html).toContain("Price, low to high");
  });

  it("shows an empty state before any searches, in Vietnamese too", () => {
    const empty = { ...report, kpis: { ...report.kpis, searches: 0 } };
    const html = renderToStaticMarkup(<AnalyticsView {...base} locale="vi" report={empty} />);
    expect(html).toContain('heading="Phân tích"');
    expect(html).not.toContain("<s-table");
  });

  it("lists synonym suggestions with the reason, product count and approve/dismiss actions (5.3)", () => {
    const html = renderToStaticMarkup(
      <AnalyticsView
        {...base}
        suggestions={[
          { query: "tshirt", searches: 5, term: "T-Shirt", reason: "spacing", products: 12 },
        ]}
      />,
    );
    expect(html).toContain("Suggested synonyms");
    expect(html).toContain("“T-Shirt” (12 products)");
    expect(html).toContain("Spacing or hyphen");
    expect(html).toContain(">Add synonym<");
    expect(html).toContain(">Dismiss<");
    expect(renderToStaticMarkup(<AnalyticsView {...base} />)).not.toContain("Suggested synonyms");
  });
});
