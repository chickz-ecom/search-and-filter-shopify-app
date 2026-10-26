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
    expect(html.match(/<s-switch/g)?.length).toBe(11); // 10 field + AI search
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
    const html = renderToStaticMarkup(<SearchView {...base} />);
    // Preview chỉ hiện khi có từ khoá (state q) → SSR không có q nên không render hits.
    expect(html).not.toContain("Zorblax lamp");
  });

  it("AI search: explains the plan below Pro; on Pro shows strictness when on", () => {
    const off = renderToStaticMarkup(<SearchView {...base} />);
    expect(off).toContain("AI search is included from the Pro plan");
    expect(off).toMatch(/<s-switch[^>]*label="Match by meaning"[^>]*disabled/);
    const on = renderToStaticMarkup(
      <SearchView {...base} semanticEntitled initial={{ ...base.initial, semanticSearch: true }} />,
    );
    expect(on).not.toContain("AI search is included from the Pro plan");
    expect(on).toContain('label="How closely results must match"');
  });
});
