import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { themeEditorLinks } from "../lib/admin/theme-links";
import { HelpView, type HelpViewProps } from "./HelpView";

const base: HelpViewProps = {
  locale: "en",
  links: themeEditorLinks("s.myshopify.com", "key123"),
  supportEmail: "help@searchapp.example",
  docsUrl: "https://docs.example/searchapp",
};

describe("HelpView (6.5)", () => {
  it("lists setup steps with theme editor deep links, FAQ and support contact", () => {
    const html = renderToStaticMarkup(<HelpView {...base} />);
    expect(html).toContain("Set up in 4 steps");
    expect(html).toContain("activateAppId=key123%2Fapp-embed".replace("%2F", "/"));
    expect(html).toContain("addAppBlockId=key123/search-results");
    expect(html).toContain('href="/app/search"');
    expect(html).toContain("What do shoppers see if the app is unavailable?");
    expect(html).toContain('href="mailto:help@searchapp.example"');
    expect(html).toContain('href="https://docs.example/searchapp"');
  });

  it("renders in Vietnamese and hides the docs link when unset", () => {
    const html = renderToStaticMarkup(<HelpView {...base} locale="vi" docsUrl="" />);
    expect(html).toContain('heading="Trợ giúp"');
    expect(html).not.toContain("Tài liệu developer");
  });
});
