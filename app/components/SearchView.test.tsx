import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSearchSettings } from "../lib/config/search-settings";
import { SearchView, type SearchViewProps } from "./SearchView";

const base: SearchViewProps = {
  locale: "en",
  initial: defaultSearchSettings(),
  metafieldDefs: [
    { namespace: "custom", key: "material", name: "Material", type: "single_line_text_field" },
  ],
  currency: "USD",
  saving: false,
  errors: {},
  preview: null,
  previewing: false,
  onSave: () => undefined,
  onPreview: () => undefined,
};

describe("SearchView (3.2)", () => {
  it("renders the field table with toggles, weights, typo/prefix and the save bar", () => {
    const html = renderToStaticMarkup(<SearchView {...base} />);
    expect(html).toContain("<ui-save-bar");
    expect(html.match(/<s-switch/g)?.length).toBe(10);
    expect(html).toContain("Weight (1–10)");
    expect(html).toContain("Restore defaults");
    expect(html).toContain("Material (custom.material)");
    expect(html).toContain("Try a search");
  });

  it("shows inline errors and metafield labels; Vietnamese strings", () => {
    const initial = defaultSearchSettings();
    initial.fields.push({
      key: "mf:custom.material",
      enabled: true,
      weight: 3,
      typo: true,
      prefix: false,
    });
    const html = renderToStaticMarkup(
      <SearchView
        {...base}
        locale="vi"
        initial={initial}
        errors={{ "fields.0.weight": "Too big" }}
      />,
    );
    expect(html).toContain("Too big");
    expect(html).toContain("Trường tìm kiếm");
    expect(html).toContain(">Material<");
  });

  it("renders preview hits with matched-field explanations", () => {
    const html = renderToStaticMarkup(
      <SearchView
        {...base}
        preview={{
          total: 1,
          tookMs: 2,
          sort: "relevance",
          hits: [
            {
              id: "1",
              title: "Zorblax lamp",
              price_min: 1999,
              currency: "USD",
              available: false,
              rank: 1,
              score: 9,
              matched: [{ key: "title", field: "title", tokens: ["Zorblax"] }],
              info: {},
            },
          ],
        }}
      />,
    );
    // Preview chỉ hiện khi có từ khoá (state q) → SSR không có q nên không render hits.
    expect(html).not.toContain("Zorblax lamp");
  });
});
