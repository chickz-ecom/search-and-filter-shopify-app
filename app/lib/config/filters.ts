import { z } from "zod";
import { metafieldDocField } from "./search-fields";
import { LocalizedLabelSchema } from "./sort-options";

// Filter tree (FilterSet.items). Dùng chung admin (builder) + search-api (facet) + SDK (render).

export const FILTER_SOURCES = [
  "vendor",
  "product_type",
  "tags",
  "collection",
  "price",
  "availability",
  "on_sale",
  "option",
  "metafield",
] as const;
export type FilterSource = (typeof FILTER_SOURCES)[number];

export const FILTER_DISPLAYS = ["checkbox", "radio", "swatch", "range", "toggle"] as const;
export type FilterDisplay = (typeof FILTER_DISPLAYS)[number];

export const FilterItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    source: z.enum(FILTER_SOURCES),
    /** Tên option (Size, Color) khi source = option. */
    optionName: z.string().optional(),
    /** `namespace.key` khi source = metafield. */
    metafield: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/)
      .optional(),
    /** Chỉ lấy tag có tiền tố (vd. `color:`) khi source = tags. */
    tagPrefix: z.string().optional(),
    label: LocalizedLabelSchema,
    display: z.enum(FILTER_DISPLAYS),
    enabled: z.boolean().default(true),
    position: z.number().int().min(0),
    collapsed: z.boolean().default(false),
    showCount: z.boolean().default(true),
    maxValues: z.number().int().min(1).max(250).default(20),
    sortValues: z.enum(["count", "alpha"]).default("count"),
    /** AND giữa các giá trị đã chọn (mặc định OR). */
    matchAll: z.boolean().default(false),
  })
  .superRefine((item, ctx) => {
    if (item.source === "option" && !item.optionName) {
      ctx.addIssue({ code: "custom", path: ["optionName"], message: "Option name is required" });
    }
    if (item.source === "metafield" && !item.metafield) {
      ctx.addIssue({ code: "custom", path: ["metafield"], message: "Metafield is required" });
    }
    if (item.source === "price" && item.display !== "range") {
      ctx.addIssue({ code: "custom", path: ["display"], message: "Price filter must use a range" });
    }
    if ((item.source === "availability" || item.source === "on_sale") && item.display === "range") {
      ctx.addIssue({
        code: "custom",
        path: ["display"],
        message: "Range is only for numeric filters",
      });
    }
  });

export type FilterItem = z.infer<typeof FilterItemSchema>;

export const FilterItemsSchema = z
  .array(FilterItemSchema)
  .max(40)
  .superRefine((items, ctx) => {
    const ids = new Set<string>();
    items.forEach((it, i) => {
      if (ids.has(it.id))
        ctx.addIssue({ code: "custom", path: [i, "id"], message: "Duplicate filter id" });
      ids.add(it.id);
    });
  });

export const DEFAULT_FILTERS: FilterItem[] = [
  {
    id: "availability",
    source: "availability",
    label: { en: "Availability", vi: "Tình trạng" },
    display: "toggle",
    enabled: true,
    position: 0,
    collapsed: false,
    showCount: true,
    maxValues: 2,
    sortValues: "count",
    matchAll: false,
  },
  {
    id: "price",
    source: "price",
    label: { en: "Price", vi: "Giá" },
    display: "range",
    enabled: true,
    position: 1,
    collapsed: false,
    showCount: false,
    maxValues: 1,
    sortValues: "count",
    matchAll: false,
  },
  {
    id: "vendor",
    source: "vendor",
    label: { en: "Brand", vi: "Thương hiệu" },
    display: "checkbox",
    enabled: true,
    position: 2,
    collapsed: false,
    showCount: true,
    maxValues: 20,
    sortValues: "count",
    matchAll: false,
  },
  {
    id: "product_type",
    source: "product_type",
    label: { en: "Product type", vi: "Loại sản phẩm" },
    display: "checkbox",
    enabled: true,
    position: 3,
    collapsed: false,
    showCount: true,
    maxValues: 20,
    sortValues: "count",
    matchAll: false,
  },
];

/** Tên field document (facet) của một filter item. */
export function facetFieldFor(
  item: Pick<FilterItem, "source" | "optionName" | "metafield">,
): string {
  switch (item.source) {
    case "vendor":
      return "vendor";
    case "product_type":
      return "product_type";
    case "tags":
      return "tags";
    case "collection":
      return "collections";
    case "price":
      return "price_min";
    case "availability":
      return "available";
    case "on_sale":
      return "on_sale";
    case "option":
      return optionDocField(item.optionName ?? "");
    case "metafield": {
      const [ns, key] = (item.metafield ?? ".").split(".");
      return metafieldDocField(ns, key);
    }
  }
}

/** `Size` → `opt_size`; `Màu sắc` → `opt_mau_sac` (ổn định, chỉ ký tự an toàn). */
export function optionDocField(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `opt_${slug || "x"}`;
}
