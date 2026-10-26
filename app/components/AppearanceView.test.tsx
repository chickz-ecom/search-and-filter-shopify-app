import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOKENS } from "../lib/config/appearance";
import { AppearanceView, type AppearanceViewProps } from "./AppearanceView";

const base: AppearanceViewProps = {
  locale: "en",
  locales: ["en", "vi"],
  currency: "USD",
  css: ".sa-grid{display:grid}",
  initial: {
    tokens: { ...DEFAULT_TOKENS, accent: "#0055ff" },
    texts: { en: { placeholder: "Find it" } },
    templates: {},
  },
  saving: false,
  errors: {},
  onSave: () => undefined,
};

describe("AppearanceView (3.6)", () => {
  it("shows the editor next to a sandboxed live preview, with the save bar", () => {
    const html = renderToStaticMarkup(<AppearanceView {...base} />);
    expect(html).toContain("<ui-save-bar");
    expect(html).toMatch(/<s-color-field[^>]*label="Accent"[^>]*value="#0055ff"/);
    expect(html).toContain('label="Products per row (desktop)"');
    expect(html).toMatch(/<iframe[^>]*title="Preview"[^>]*sandbox=""/);
    // Preview phản ánh token + text đang sửa.
    expect(html).toContain("--sa-accent:#0055ff");
    expect(html).toContain("placeholder=&quot;Find it&quot;");
  });

  it("offers per-locale texts and template overrides, and surfaces field errors", () => {
    const html = renderToStaticMarkup(
      <AppearanceView {...base} errors={{ "tokens.accent": "Use a hex color like #1a1a1a" }} />,
    );
    expect(html).toContain('label="Language"');
    expect(html).toContain('label="Search box placeholder"');
    expect(html).toContain("<s-text-area");
    expect(html).toContain("Use a hex color like #1a1a1a");
    expect(html).toContain("Some values aren&#x27;t valid");
  });

  it("renders in Vietnamese", () => {
    const html = renderToStaticMarkup(<AppearanceView {...base} locale="vi" />);
    expect(html).toContain('heading="Giao diện"');
    expect(html).toContain('label="Màu nhấn"');
  });
});
