import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MerchIndexView, MerchListView, type MerchListViewProps } from "./MerchViews";

const lists: MerchListViewProps["lists"] = {
  synonyms: [
    { id: "s1", type: "one_way", root: "trainers", terms: ["sneakers", "runners"], locale: null },
  ],
  redirects: [],
  stopwords: [{ id: "w1", word: "the", locale: "en" }],
  rules: [
    {
      id: "r1",
      name: "Pin red",
      enabled: false,
      condition: { collectionId: "77", match: "exact" },
      actions: { pin: [{ productId: "5", position: 1 }], hide: [], boost: [] },
      startsAt: null,
      endsAt: null,
    },
  ],
};
const base: MerchListViewProps = {
  locale: "en",
  type: "synonyms",
  lists,
  names: { "77": "Summer", "5": "Red tee" },
  busy: false,
  errors: {},
  saved: null,
  onMutate: () => undefined,
  onPickProducts: async () => [],
  onPickCollection: async () => null,
};

describe("Merchandising views (3.5)", () => {
  it("overview shows counts and links", () => {
    const html = renderToStaticMarkup(
      <MerchIndexView locale="vi" counts={{ synonyms: 1, redirects: 0, rules: 2, stopwords: 3 }} />,
    );
    expect(html).toContain("Từ đồng nghĩa");
    expect(html).toContain('href="/app/merchandising/rules"');
  });

  it("lists synonyms in an s-table with edit/delete and a modal", () => {
    const html = renderToStaticMarkup(<MerchListView {...base} />);
    expect(html).toContain("<s-table");
    expect(html).toContain("trainers → sneakers, runners");
    expect(html).toContain('<s-modal id="merch-modal"');
    expect(html).toContain('<s-modal id="merch-delete"');
  });

  it("shows an empty state with a call to action", () => {
    const html = renderToStaticMarkup(<MerchListView {...base} type="redirects" />);
    expect(html).toContain("<s-empty-state");
    expect(html).toContain("Nothing here yet");
  });

  it("summarises rules with collection names and disabled badge", () => {
    const html = renderToStaticMarkup(<MerchListView {...base} type="rules" />);
    expect(html).toContain("Collection: Summer");
    expect(html).toContain("Pinned products: 1");
    expect(html).toContain("Disabled");
  });
});
