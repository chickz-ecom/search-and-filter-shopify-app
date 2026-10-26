// Kiểu + hằng số Analytics v2 dùng chung server/client (component không được import file .server).

export type MetricKey =
  "clicks" | "searches" | "zeroResults" | "clickedValue" | "filtersApplied" | "boughtValue";
export const METRICS: MetricKey[] = [
  "clicks",
  "searches",
  "zeroResults",
  "clickedValue",
  "filtersApplied",
  "boughtValue",
];

export type ProductRef = { id: string; title: string; image: string | null; handle: string | null };
export type Overview = {
  totals: Record<MetricKey, number>;
  series: { date: string; values: Record<MetricKey, number> }[];
  topQueries: { query: string; searches: number }[];
  topClicked: (ProductRef & { clicks: number })[];
  topZero: { query: string; count: number }[];
  topBought: (ProductRef & { purchases: number })[];
  topFilters: { filter: string; count: number }[];
  topFilterValues: { filter: string; value: string; count: number }[];
  topCollections: { id: string; title: string; views: number }[];
};

export type Column = { key: string; kind: "text" | "number" | "money" | "percent" | "product" };
export type Row = Record<string, string | number | null> & { _image?: string | null };
export type Table = { columns: Column[]; rows: Row[] };

export const REPORTS = [
  "search-queries",
  "search-zero",
  "search-suggestions",
  "search-products",
  "search-filters",
  "search-filter-values",
  "search-filter-combos",
  "search-sorts",
  "collections",
  "collection-filters",
  "collection-filter-values",
  "collection-filter-combos",
] as const;
export type ReportKey = (typeof REPORTS)[number];
