import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DevelopersInfo } from "../lib/admin/developers.server";
import { DevelopersView, type DevelopersViewProps } from "./DevelopersView";

const info: DevelopersInfo = {
  shopDomain: "acme.myshopify.com",
  publicKey: "pk_test123",
  endpoint: "https://api.example",
  docsUrl: "https://docs.example/searchapp",
  headless: { entitled: false, minPlan: "Pro", enabled: false, origins: [] },
};
const base: DevelopersViewProps = {
  locale: "en",
  info,
  saving: false,
  errors: {},
  onSave: () => undefined,
  onCopy: () => undefined,
};

describe("DevelopersView (3.8)", () => {
  it("shows key, endpoint, docs link and copyable snippets", () => {
    const html = renderToStaticMarkup(<DevelopersView {...base} />);
    expect(html).toMatch(/<s-text-field[^>]*label="Public key"[^>]*value="pk_test123"/);
    expect(html).toContain('value="https://api.example"');
    expect(html).toContain('href="https://docs.example/searchapp"');
    expect(html).toContain("window.SearchApp?.ready()");
    expect(html).toContain(
      "https://api.example/v1/search?shop=acme.myshopify.com&amp;key=pk_test123",
    );
    expect(html).toContain("&lt;template data-searchapp=&quot;product-card&quot;&gt;");
    expect(html).toContain("<ui-save-bar");
  });

  it("explains the plan requirement and disables the headless switch below Pro", () => {
    const html = renderToStaticMarkup(<DevelopersView {...base} />);
    expect(html).toContain("Headless access is included from the Pro plan");
    expect(html).toContain('href="/app/plans"');
    expect(html).toMatch(/<s-switch[^>]*label="Allow headless requests"[^>]*disabled/);
    expect(html).not.toContain("Allowed browser origins");
  });

  it("on an entitled plan shows the origins field when enabled, with errors; no docs link when unset", () => {
    const html = renderToStaticMarkup(
      <DevelopersView
        {...base}
        info={{
          ...info,
          docsUrl: "",
          headless: {
            ...info.headless,
            entitled: true,
            enabled: true,
            origins: ["https://a.example"],
          },
        }}
        errors={{ "headlessOrigins.0": "Use an origin like https://www.example.com (no path)" }}
      />,
    );
    expect(html).not.toContain("Headless access is included");
    expect(html).toContain("Allowed browser origins (optional)");
    expect(html).toContain("https://a.example");
    expect(html).toContain("Use an origin like https://www.example.com (no path)");
    expect(html).not.toContain("Developer docs");
  });
});
