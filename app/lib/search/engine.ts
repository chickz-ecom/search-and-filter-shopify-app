// Interface SearchEngine (D5): mọi truy cập engine đi qua đây để có thể đổi engine.
// Kiểu tham số bám sát Typesense nhưng không lộ client của nó ra ngoài.

export type FieldType =
  | "string"
  | "string[]"
  | "int32"
  | "int32[]"
  | "int64"
  | "int64[]"
  | "float"
  | "float[]"
  | "bool"
  | "bool[]"
  | "auto"
  | "string*";

export type FieldDef = {
  name: string;
  type: FieldType;
  facet?: boolean;
  optional?: boolean;
  index?: boolean;
  sort?: boolean;
  infix?: boolean;
  locale?: string;
  /** Typesense auto-embedding (task 5.1): vector sinh từ các field `from` bằng model. */
  embed?: { from: string[]; model: string };
};

export type CollectionSchema = {
  name: string;
  fields: FieldDef[];
  defaultSortingField?: string;
  tokenSeparators?: string[];
  symbolsToIndex?: string[];
  synonymSets?: string[];
  curationSets?: string[];
  metadata?: Record<string, unknown>;
};

export type ImportAction = "upsert" | "emplace" | "update" | "create";

export type ImportResult = {
  success: number;
  failed: number;
  errors: { id?: string; error: string; code?: number }[];
};

export type SearchParams = {
  q: string;
  queryBy: string[];
  queryByWeights?: number[];
  numTypos?: number[];
  prefix?: boolean[];
  infix?: ("off" | "always" | "fallback")[];
  filterBy?: string;
  sortBy?: string;
  facetBy?: string[];
  maxFacetValues?: number;
  facetQuery?: string;
  page?: number;
  perPage?: number;
  includeFields?: string[];
  excludeFields?: string[];
  pinnedHits?: { id: string; position: number }[];
  hiddenHits?: string[];
  prioritizeExactMatch?: boolean;
  textMatchType?: "max_score" | "max_weight" | "sum_score";
  minLen1Typo?: number;
  minLen2Typo?: number;
  dropTokensThreshold?: number;
  typoTokensThreshold?: number;
  enableOverrides?: boolean;
  /** Tag curation (rule `tags`) — trang collection gửi `col_{id}`. Typesense 30: tham số `curation_tags` (override_tags bị bỏ qua — đã đo). */
  curationTags?: string[];
  synonymSets?: string[];
  stopwords?: string;
  highlightFields?: string[];
  searchCutoffMs?: number;
  useCache?: boolean;
  cacheTtl?: number;
  /** Bật trả `text_match_info` để giải thích thứ hạng (trang "Thử tìm"). */
  explain?: boolean;
  /** Hybrid search: `embedding:([], alpha: …, distance_threshold: …)`. */
  vectorQuery?: string;
};

export type FacetCount = {
  field: string;
  values: { value: string; count: number }[];
  stats?: { min?: number; max?: number; avg?: number; sum?: number; totalValues?: number };
};

export type SearchHit<T> = {
  document: T;
  textMatch?: number;
  textMatchInfo?: Record<string, unknown>;
  highlights?: { field: string; snippet?: string; matchedTokens?: string[] }[];
  curated?: boolean;
  /** Khoảng cách vector (hybrid search) — càng nhỏ càng gần nghĩa. */
  vectorDistance?: number;
};

export type SearchResult<T> = {
  found: number;
  outOf: number;
  page: number;
  hits: SearchHit<T>[];
  facets: FacetCount[];
  searchTimeMs: number;
  /** Override/curation khớp (merch). */
  appliedRules?: string[];
};

export type SynonymItem = {
  id: string;
  synonyms: string[];
  /** Có root → one-way (root → synonyms). */
  root?: string;
  locale?: string;
};

export type CurationItem = {
  id: string;
  rule: { query?: string; match?: "exact" | "contains"; filterBy?: string; tags?: string[] };
  includes?: { id: string; position: number }[];
  excludes?: { id: string }[];
  filterBy?: string;
  sortBy?: string;
  replaceQuery?: string;
  removeMatchedTokens?: boolean;
  filterCuratedHits?: boolean;
  stopProcessing?: boolean;
  effectiveFromTs?: number;
  effectiveToTs?: number;
};

export type ScopedKeyParams = {
  filterBy?: string;
  expiresAt?: number;
  /** Giới hạn collection/alias được search. */
  collections?: string[];
};

export interface SearchEngine {
  health(): Promise<boolean>;
  /** Snapshot toàn bộ dữ liệu engine vào thư mục TRÊN MÁY engine (backup, task 6.2). */
  snapshot?(path: string): Promise<void>;

  createCollection(schema: CollectionSchema): Promise<void>;
  /** Thêm field mới vào collection có sẵn (không cần re-index nếu field optional). */
  addFields(collection: string, fields: FieldDef[]): Promise<void>;
  /** Trả về null nếu không có. */
  getCollection(
    name: string,
  ): Promise<{ name: string; numDocuments: number; fields: FieldDef[] } | null>;
  listCollections(prefix?: string): Promise<string[]>;
  dropCollection(name: string): Promise<void>;

  getAlias(alias: string): Promise<string | null>;
  upsertAlias(alias: string, collection: string): Promise<void>;
  deleteAlias(alias: string): Promise<void>;

  importDocuments<T extends { id: string }>(
    collection: string,
    docs: T[],
    action?: ImportAction,
  ): Promise<ImportResult>;
  /** Cập nhật một phần (vd. pos_*, best_selling_rank). Document không tồn tại → bỏ qua. */
  updateDocuments(
    collection: string,
    docs: ({ id: string } & Record<string, unknown>)[],
  ): Promise<ImportResult>;
  getDocument<T>(collection: string, id: string): Promise<T | null>;
  deleteDocuments(collection: string, ids: string[]): Promise<number>;
  deleteByFilter(collection: string, filterBy: string): Promise<number>;
  /** Stream id + field được chọn (checksum đêm); `includeFields` rỗng = mọi field (reindex), trừ `excludeFields`. */
  exportDocuments<T>(
    collection: string,
    includeFields: string[],
    filterBy?: string,
    excludeFields?: string[],
  ): AsyncIterable<T>;

  search<T>(collection: string, params: SearchParams): Promise<SearchResult<T>>;
  multiSearch<T>(
    searches: { collection: string; params: SearchParams }[],
  ): Promise<SearchResult<T>[]>;

  upsertSynonymSet(name: string, items: SynonymItem[]): Promise<void>;
  deleteSynonymSet(name: string): Promise<void>;
  upsertCurationSet(name: string, items: CurationItem[]): Promise<void>;
  deleteCurationSet(name: string): Promise<void>;
  upsertStopwords(id: string, words: string[], locale?: string): Promise<void>;
  deleteStopwords(id: string): Promise<void>;
  /** Gắn synonym/curation set vào collection. */
  linkSets(
    collection: string,
    sets: { synonymSets?: string[]; curationSets?: string[] },
  ): Promise<void>;

  generateScopedKey(params: ScopedKeyParams): string;
}

export class EngineUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EngineUnavailableError";
  }
}
