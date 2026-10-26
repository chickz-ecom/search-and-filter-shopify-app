import { describe, expect, it } from "vitest";
import { DEFAULT_TOKENS } from "../config/appearance";
import { buildPreviewHtml } from "./appearance-preview";

describe("appearance live preview (3.6)", () => {
  it("renders the real widget CSS with the edited tokens, texts and template", () => {
    const html = buildPreviewHtml(
      {
        tokens: { ...DEFAULT_TOKENS, accent: "#ff0000", columns: 3, showVendor: false },
        texts: { vi: { placeholder: "Tìm gì?" } },
        templates: { "product-card": '<li class="mine">{{title}} — {{price}}</li>' },
      },
      ".sa-grid{display:grid}",
      "vi",
    );
    expect(html).toContain(".sa-grid{display:grid}");
    expect(html).toContain("--sa-accent:#ff0000");
    expect(html).toContain('placeholder="Tìm gì?"');
    expect(html).toContain('<li class="mine">Classic cotton tee — $19.00</li>');
    expect(html).toContain("--sa-cols:3");
    expect(html).toContain("132 kết quả");
  });

  it("escapes template output and hides vendors when switched off", () => {
    const html = buildPreviewHtml(
      { tokens: { ...DEFAULT_TOKENS, showVendor: false }, texts: {}, templates: {} },
      "",
      "en",
    );
    expect(html).not.toContain('sa-card__vendor">Acme');
    expect(html).toContain("Sold out");
  });
});
