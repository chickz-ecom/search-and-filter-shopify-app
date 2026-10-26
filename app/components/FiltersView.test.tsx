import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "../lib/config/filters";
import { displaysFor, FiltersView, type FiltersViewProps } from "./FiltersView";

const base: FiltersViewProps = {
  locale: "en",
  locales: ["en", "vi"],
  initial: {
    default: DEFAULT_FILTERS,
    search: null,
    collections: { "77": DEFAULT_FILTERS.slice(0, 1) },
  },
  metafieldDefs: [
    { namespace: "custom", key: "material", name: "Material", type: "single_line_text_field" },
  ],
  collectionTitles: { "77": "Summer" },
  saving: false,
  errors: {},
  onSave: () => undefined,
  onPickCollections: async () => [],
};

describe("FiltersView (3.4)", () => {
  it("renders the default tree with scope selector, per-locale labels and save bar", () => {
    const html = renderToStaticMarkup(<FiltersView {...base} />);
    expect(html).toContain("<ui-save-bar");
    expect(html).toContain("Default (all pages)");
    expect(html).toContain("Collection: Summer");
    expect(html.match(/<s-switch/g)?.length).toBe(DEFAULT_FILTERS.length);
  });

  it("shows a compact list (name + summary + actions) and keeps details for the edit modal", () => {
    const html = renderToStaticMarkup(<FiltersView {...base} />);
    expect(html).toContain("Brand");
    expect(html).toContain("Vendor · Checkboxes · up to 20 values");
    expect(html).toContain(">Edit<");
    expect(html).toContain('id="filter-modal"');
    // Không còn trải các ô nhãn theo ngôn ngữ / chọn nguồn trên trang.
    expect(html).not.toContain("Label (vi)");
    expect(html).not.toMatch(/<s-select[^>]*label="Filter by"/);
  });

  it("lists every error inline in a critical banner", () => {
    const html = renderToStaticMarkup(
      <FiltersView {...base} errors={{ "default.2.optionName": "Option name is required" }} />,
    );
    // Lỗi gọi theo tên filter, không phải đường dẫn kỹ thuật; dòng filter được đánh dấu.
    expect(html).toContain("Brand: Option name is required");
    expect(html).not.toContain("default.2.optionName");
    expect(html).toContain("Needs attention");
  });

  it("offers only valid displays per source", () => {
    expect(displaysFor("price")).toEqual(["range"]);
    expect(displaysFor("availability")).toEqual(["toggle"]);
    expect(displaysFor("option")).toContain("swatch");
    expect(displaysFor("metafield", "number_integer")[0]).toBe("range");
    expect(displaysFor("vendor")).toEqual(["checkbox", "radio"]);
  });
});
