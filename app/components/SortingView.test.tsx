import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_SORT_OPTIONS } from "../lib/config/sort-options";
import { SortingView, type SortingViewProps } from "./SortingView";

const base: SortingViewProps = {
  locale: "en",
  locales: ["en", "vi"],
  initial: {
    options: DEFAULT_SORT_OPTIONS,
    defaults: { search: "relevance" },
    overrides: [{ collectionId: "77", sortKey: "price_asc" }],
    tieBreak: "best_selling",
  },
  metafieldDefs: [
    { namespace: "custom", key: "rating", name: "Rating", type: "rating" },
    { namespace: "custom", key: "material", name: "Material", type: "single_line_text_field" },
  ],
  availability: { bestSelling: false },
  collectionTitles: { "77": "Summer" },
  saving: false,
  errors: {},
  onSave: () => undefined,
  onPickCollections: async () => [],
};

describe("SortingView (3.3)", () => {
  it("lists options with per-locale labels, reorder controls and the save bar", () => {
    const html = renderToStaticMarkup(<SortingView {...base} />);
    expect(html).toContain("<ui-save-bar");
    expect(html.match(/draggable="true"/g)?.length).toBe(DEFAULT_SORT_OPTIONS.length);
    expect(html).toContain("Label (vi)");
    expect(html).toContain('value="Giá tăng dần"');
    expect(html).toContain("Move up: Relevance");
  });

  it("disables best selling until there is sales data, with an explanation", () => {
    const html = renderToStaticMarkup(<SortingView {...base} />);
    expect(html).toContain("Needs sales data");
    expect(html).toMatch(/<s-switch[^>]*label="Best selling"[^>]*disabled/);
  });

  it("only offers number/date metafields for sorting and shows collection overrides", () => {
    const html = renderToStaticMarkup(<SortingView {...base} />);
    expect(html).toContain("Rating (custom.rating)");
    expect(html).not.toContain("Material (custom.material)");
    expect(html).toContain('label="Summer"');
  });
});
