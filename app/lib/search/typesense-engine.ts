import { createInterface } from "node:readline";
import { Client } from "typesense";
import type { Readable } from "node:stream";
import {
  EngineUnavailableError,
  type CollectionSchema,
  type CurationItem,
  type FacetCount,
  type FieldDef,
  type ImportAction,
  type ImportResult,
  type ScopedKeyParams,
  type SearchEngine,
  type SearchParams,
  type SearchResult,
  type SynonymItem,
} from "./engine";

export type TypesenseConfig = {
  host: string;
  port: number;
  protocol: "http" | "https";
  apiKey: string;
  /** Key chỉ có quyền search; nền cho scoped key theo shop. */
  searchOnlyKey?: string;
  connectionTimeoutSeconds?: number;
  /** Nhiều node cho HA (task 6.2). */
  nodes?: { host: string; port: number; protocol: "http" | "https" }[];
};

type Json = Record<string, unknown>;

// Lỗi HTTP của client typesense có `httpStatus`.
function statusOf(err: unknown): number | undefined {
  return (err as { httpStatus?: number })?.httpStatus;
}

function isNotFound(err: unknown) {
  return statusOf(err) === 404;
}

function isUnavailable(err: unknown) {
  const s = statusOf(err);
  if (s === undefined) return true; // lỗi mạng/timeout
  return s >= 500;
}

function wrap<T>(p: Promise<T>, what: string): Promise<T> {
  return p.catch((err: unknown) => {
    if (isUnavailable(err))
      throw new EngineUnavailableError(`Typesense unavailable during ${what}`, err);
    throw err;
  });
}

function toEngineField(f: FieldDef): Json {
  const out: Json = { name: f.name, type: f.type };
  if (f.facet !== undefined) out.facet = f.facet;
  if (f.optional !== undefined) out.optional = f.optional;
  if (f.index !== undefined) out.index = f.index;
  if (f.sort !== undefined) out.sort = f.sort;
  if (f.infix !== undefined) out.infix = f.infix;
  if (f.locale) out.locale = f.locale;
  if (f.embed) out.embed = { from: f.embed.from, model_config: { model_name: f.embed.model } };
  return out;
}

/** Chỉ để test ánh xạ field. */
export const toEngineFieldForTest = (f: FieldDef) => toEngineField(f);

export function toTypesenseSearchParams(p: SearchParams): Json {
  const out: Json = {
    q: p.q || "*",
    query_by: p.queryBy.join(","),
  };
  if (p.queryByWeights?.length) out.query_by_weights = p.queryByWeights.join(",");
  if (p.numTypos?.length) out.num_typos = p.numTypos.join(",");
  if (p.prefix?.length) out.prefix = p.prefix.join(",");
  if (p.infix?.length) out.infix = p.infix.join(",");
  if (p.filterBy) out.filter_by = p.filterBy;
  if (p.sortBy) out.sort_by = p.sortBy;
  if (p.facetBy?.length) out.facet_by = p.facetBy.join(",");
  if (p.maxFacetValues) out.max_facet_values = p.maxFacetValues;
  if (p.facetQuery) out.facet_query = p.facetQuery;
  if (p.page) out.page = p.page;
  if (p.perPage !== undefined) out.per_page = p.perPage;
  if (p.includeFields?.length) out.include_fields = p.includeFields.join(",");
  if (p.excludeFields?.length) out.exclude_fields = p.excludeFields.join(",");
  if (p.pinnedHits?.length)
    out.pinned_hits = p.pinnedHits.map((h) => `${h.id}:${h.position}`).join(",");
  if (p.hiddenHits?.length) out.hidden_hits = p.hiddenHits.join(",");
  if (p.prioritizeExactMatch !== undefined) out.prioritize_exact_match = p.prioritizeExactMatch;
  if (p.textMatchType) out.text_match_type = p.textMatchType;
  if (p.minLen1Typo) out.min_len_1typo = p.minLen1Typo;
  if (p.minLen2Typo) out.min_len_2typo = p.minLen2Typo;
  if (p.dropTokensThreshold !== undefined) out.drop_tokens_threshold = p.dropTokensThreshold;
  if (p.typoTokensThreshold !== undefined) out.typo_tokens_threshold = p.typoTokensThreshold;
  if (p.enableOverrides !== undefined) out.enable_overrides = p.enableOverrides;
  if (p.curationTags?.length) out.curation_tags = p.curationTags.join(",");
  if (p.synonymSets?.length) out.synonym_sets = p.synonymSets.join(",");
  if (p.stopwords) out.stopwords = p.stopwords;
  if (p.highlightFields?.length) out.highlight_fields = p.highlightFields.join(",");
  else out.highlight_fields = "none";
  if (p.searchCutoffMs) out.search_cutoff_ms = p.searchCutoffMs;
  if (p.vectorQuery) out.vector_query = p.vectorQuery;
  if (p.useCache) {
    out.use_cache = true;
    if (p.cacheTtl) out.cache_ttl = p.cacheTtl;
  }
  return out;
}

type RawHit = {
  document: Json;
  text_match?: number;
  text_match_info?: Json;
  highlights?: { field: string; snippet?: string; matched_tokens?: string[] }[];
  curated?: boolean;
  vector_distance?: number;
};

type RawResult = {
  found?: number;
  out_of?: number;
  page?: number;
  hits?: RawHit[];
  facet_counts?: { field_name: string; counts: { value: string; count: number }[]; stats?: Json }[];
  search_time_ms?: number;
  metadata?: Json;
  error?: string;
  code?: number;
};

export function fromTypesenseResult<T>(raw: RawResult): SearchResult<T> {
  const facets: FacetCount[] = (raw.facet_counts ?? []).map((f) => ({
    field: f.field_name,
    values: f.counts.map((c) => ({ value: c.value, count: c.count })),
    stats: f.stats
      ? {
          min: f.stats.min as number | undefined,
          max: f.stats.max as number | undefined,
          avg: f.stats.avg as number | undefined,
          sum: f.stats.sum as number | undefined,
          totalValues: f.stats.total_values as number | undefined,
        }
      : undefined,
  }));
  return {
    found: raw.found ?? 0,
    outOf: raw.out_of ?? 0,
    page: raw.page ?? 1,
    hits: (raw.hits ?? []).map((h) => ({
      document: h.document as T,
      textMatch: h.text_match,
      textMatchInfo: h.text_match_info,
      highlights: h.highlights?.map((x) => ({
        field: x.field,
        snippet: x.snippet,
        matchedTokens: x.matched_tokens,
      })),
      curated: h.curated,
      ...(h.vector_distance !== undefined ? { vectorDistance: h.vector_distance } : {}),
    })),
    facets,
    searchTimeMs: raw.search_time_ms ?? 0,
  };
}

function toCurationObject(c: CurationItem): Json {
  const rule: Json = {};
  if (c.rule.query !== undefined) {
    rule.query = c.rule.query;
    rule.match = c.rule.match ?? "exact";
  }
  if (c.rule.filterBy) rule.filter_by = c.rule.filterBy;
  if (c.rule.tags?.length) rule.tags = c.rule.tags;
  const out: Json = { id: c.id, rule };
  if (c.includes?.length) out.includes = c.includes;
  if (c.excludes?.length) out.excludes = c.excludes;
  if (c.filterBy) out.filter_by = c.filterBy;
  if (c.sortBy) out.sort_by = c.sortBy;
  if (c.replaceQuery) out.replace_query = c.replaceQuery;
  if (c.removeMatchedTokens !== undefined) out.remove_matched_tokens = c.removeMatchedTokens;
  if (c.filterCuratedHits !== undefined) out.filter_curated_hits = c.filterCuratedHits;
  if (c.stopProcessing !== undefined) out.stop_processing = c.stopProcessing;
  if (c.effectiveFromTs) out.effective_from_ts = c.effectiveFromTs;
  if (c.effectiveToTs) out.effective_to_ts = c.effectiveToTs;
  return out;
}

export class TypesenseEngine implements SearchEngine {
  private readonly client: Client;

  constructor(private readonly config: TypesenseConfig) {
    const nodes = config.nodes?.length
      ? config.nodes
      : [{ host: config.host, port: config.port, protocol: config.protocol }];
    this.client = new Client({
      nodes,
      apiKey: config.apiKey,
      connectionTimeoutSeconds: config.connectionTimeoutSeconds ?? 5,
      numRetries: nodes.length > 1 ? 3 : 1,
      retryIntervalSeconds: 0.1,
      logLevel: "silent",
    });
  }

  // Client typed theo schema chung chung; giữ `any` trong một chỗ duy nhất.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get c(): any {
    return this.client;
  }

  async health(): Promise<boolean> {
    try {
      const r = await this.c.health.retrieve();
      return Boolean(r?.ok);
    } catch {
      return false;
    }
  }

  async createCollection(schema: CollectionSchema): Promise<void> {
    const body: Json = { name: schema.name, fields: schema.fields.map(toEngineField) };
    if (schema.defaultSortingField) body.default_sorting_field = schema.defaultSortingField;
    if (schema.tokenSeparators) body.token_separators = schema.tokenSeparators;
    if (schema.symbolsToIndex) body.symbols_to_index = schema.symbolsToIndex;
    if (schema.synonymSets?.length) body.synonym_sets = schema.synonymSets;
    if (schema.curationSets?.length) body.curation_sets = schema.curationSets;
    if (schema.metadata) body.metadata = schema.metadata;
    await wrap(this.c.collections().create(body), "createCollection");
  }

  async addFields(collection: string, fields: FieldDef[]): Promise<void> {
    if (!fields.length) return;
    await wrap(
      this.c.collections(collection).update({ fields: fields.map(toEngineField) }),
      "addFields",
    );
  }

  async getCollection(name: string) {
    try {
      const r = await this.c.collections(name).retrieve();
      return {
        name: r.name as string,
        numDocuments: r.num_documents as number,
        fields: r.fields as FieldDef[],
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      if (isUnavailable(err))
        throw new EngineUnavailableError("Typesense unavailable during getCollection", err);
      throw err;
    }
  }

  async listCollections(prefix?: string): Promise<string[]> {
    const all: { name: string }[] = await wrap(this.c.collections().retrieve(), "listCollections");
    return all.map((c) => c.name).filter((n) => !prefix || n.startsWith(prefix));
  }

  async dropCollection(name: string): Promise<void> {
    try {
      await this.c.collections(name).delete();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async getAlias(alias: string): Promise<string | null> {
    try {
      const r = await this.c.aliases(alias).retrieve();
      return r.collection_name as string;
    } catch (err) {
      if (isNotFound(err)) return null;
      if (isUnavailable(err))
        throw new EngineUnavailableError("Typesense unavailable during getAlias", err);
      throw err;
    }
  }

  async upsertAlias(alias: string, collection: string): Promise<void> {
    await wrap(this.c.aliases().upsert(alias, { collection_name: collection }), "upsertAlias");
  }

  async deleteAlias(alias: string): Promise<void> {
    try {
      await this.c.aliases(alias).delete();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async importDocuments<T extends { id: string }>(
    collection: string,
    docs: T[],
    action: ImportAction = "upsert",
  ): Promise<ImportResult> {
    if (!docs.length) return { success: 0, failed: 0, errors: [] };
    return this.importJsonl(collection, docs, action);
  }

  async updateDocuments(
    collection: string,
    docs: ({ id: string } & Record<string, unknown>)[],
  ): Promise<ImportResult> {
    if (!docs.length) return { success: 0, failed: 0, errors: [] };
    const res = await this.importJsonl(collection, docs, "update");
    // "Không tồn tại" không phải lỗi với cập nhật một phần.
    const errors = res.errors.filter((e) => e.code !== 404);
    return { success: res.success, failed: errors.length, errors };
  }

  private nodeCursor = 0;

  private nodeUrls(): string[] {
    const nodes = this.config.nodes?.length
      ? this.config.nodes
      : [{ host: this.config.host, port: this.config.port, protocol: this.config.protocol }];
    return nodes.map((n) => `${n.protocol}://${n.host}:${n.port}`);
  }

  /**
   * Import qua fetch native thay vì client typesense: client (axios) giữ lại bộ nhớ qua các lần import lớn
   * (đo: 100 lô × 1.000 doc OOM ở heap 160 MB; fetch: ổn định). Xoay vòng node + retry khi lỗi mạng/5xx.
   */
  private async importJsonl(
    collection: string,
    docs: { id: string }[],
    action: ImportAction,
  ): Promise<ImportResult> {
    const jsonl = docs.map((d) => JSON.stringify(d)).join("\n");
    const urls = this.nodeUrls();
    const path = `/collections/${encodeURIComponent(collection)}/documents/import?action=${action}&dirty_values=coerce_or_drop`;
    let raw = "";
    let lastErr: unknown;
    const attempts = Math.max(2, urls.length + 1);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const base = urls[this.nodeCursor++ % urls.length];
      try {
        const res = await fetch(base + path, {
          method: "POST",
          headers: { "X-TYPESENSE-API-KEY": this.config.apiKey, "Content-Type": "text/plain" },
          body: jsonl,
          signal: AbortSignal.timeout((this.config.connectionTimeoutSeconds ?? 5) * 1000 * 12),
        });
        raw = await res.text();
        if (res.status === 404)
          throw Object.assign(new Error(`Collection ${collection} not found`), { httpStatus: 404 });
        if (res.status >= 500)
          throw Object.assign(new Error(`Typesense import HTTP ${res.status}`), {
            httpStatus: res.status,
          });
        if (res.status >= 400 && !raw.includes('"success"')) {
          throw Object.assign(
            new Error(`Typesense import HTTP ${res.status}: ${raw.slice(0, 200)}`),
            { httpStatus: res.status },
          );
        }
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (!isUnavailable(err)) throw err;
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      }
    }
    if (lastErr) throw new EngineUnavailableError("Typesense unavailable during import", lastErr);
    const result: ImportResult = { success: 0, failed: 0, errors: [] };
    raw.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      const r = JSON.parse(line) as { success: boolean; error?: string; code?: number };
      if (r.success) result.success++;
      else {
        result.failed++;
        result.errors.push({ id: docs[i]?.id, error: r.error ?? "unknown", code: r.code });
      }
    });
    return result;
  }

  async getDocument<T>(collection: string, id: string): Promise<T | null> {
    try {
      return (await this.c.collections(collection).documents(id).retrieve()) as T;
    } catch (err) {
      if (isNotFound(err)) return null;
      if (isUnavailable(err))
        throw new EngineUnavailableError("Typesense unavailable during getDocument", err);
      throw err;
    }
  }

  async deleteDocuments(collection: string, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    let deleted = 0;
    // filter_by theo id, chia lô để giữ URL ngắn.
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200).map((id) => `\`${id.replace(/`/g, "")}\``);
      deleted += await this.deleteByFilter(collection, `id:[${chunk.join(",")}]`);
    }
    return deleted;
  }

  async deleteByFilter(collection: string, filterBy: string): Promise<number> {
    try {
      const r = await this.c.collections(collection).documents().delete({ filter_by: filterBy });
      return (r?.num_deleted as number) ?? 0;
    } catch (err) {
      if (isNotFound(err)) return 0;
      if (isUnavailable(err))
        throw new EngineUnavailableError("Typesense unavailable during delete", err);
      throw err;
    }
  }

  async *exportDocuments<T>(
    collection: string,
    includeFields: string[],
    filterBy?: string,
  ): AsyncIterable<T> {
    const params: Json = { include_fields: includeFields.join(",") };
    if (filterBy) params.filter_by = filterBy;
    const stream: Readable = await wrap(
      this.c.collections(collection).documents().exportStream(params),
      "export",
    );
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim()) yield JSON.parse(line) as T;
    }
  }

  async search<T>(collection: string, params: SearchParams): Promise<SearchResult<T>> {
    const raw: RawResult = await wrap(
      this.c.collections(collection).documents().search(toTypesenseSearchParams(params), {}),
      "search",
    );
    return fromTypesenseResult<T>(raw);
  }

  async multiSearch<T>(
    searches: { collection: string; params: SearchParams }[],
  ): Promise<SearchResult<T>[]> {
    if (!searches.length) return [];
    const body = {
      searches: searches.map((s) => ({
        collection: s.collection,
        ...toTypesenseSearchParams(s.params),
      })),
    };
    const raw: { results: RawResult[] } = await wrap(
      this.c.multiSearch.perform(body, {}),
      "multiSearch",
    );
    return raw.results.map((r) => {
      if (r.error) {
        if ((r.code ?? 500) >= 500) throw new EngineUnavailableError(r.error);
        throw new Error(`multiSearch: ${r.error}`);
      }
      return fromTypesenseResult<T>(r);
    });
  }

  async upsertSynonymSet(name: string, items: SynonymItem[]): Promise<void> {
    await wrap(
      this.c.synonymSets(name).upsert({
        items: items.map((s) => ({
          id: s.id,
          synonyms: s.synonyms,
          ...(s.root ? { root: s.root } : {}),
          ...(s.locale ? { locale: s.locale } : {}),
        })),
      }),
      "upsertSynonymSet",
    );
  }

  async deleteSynonymSet(name: string): Promise<void> {
    try {
      await this.c.synonymSets(name).delete();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async upsertCurationSet(name: string, items: CurationItem[]): Promise<void> {
    await wrap(
      this.c.curationSets(name).upsert({ items: items.map(toCurationObject) }),
      "upsertCurationSet",
    );
  }

  async deleteCurationSet(name: string): Promise<void> {
    try {
      await this.c.curationSets(name).delete();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async upsertStopwords(id: string, words: string[], locale?: string): Promise<void> {
    await wrap(
      this.c.stopwords().upsert(id, { stopwords: words, ...(locale ? { locale } : {}) }),
      "stopwords",
    );
  }

  async deleteStopwords(id: string): Promise<void> {
    try {
      await this.c.stopwords(id).delete();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async linkSets(
    collection: string,
    sets: { synonymSets?: string[]; curationSets?: string[] },
  ): Promise<void> {
    const body: Json = {};
    if (sets.synonymSets) body.synonym_sets = sets.synonymSets;
    if (sets.curationSets) body.curation_sets = sets.curationSets;
    await wrap(this.c.collections(collection).update(body), "linkSets");
  }

  generateScopedKey(params: ScopedKeyParams): string {
    const base = this.config.searchOnlyKey;
    if (!base) throw new Error("TYPESENSE_SEARCH_ONLY_KEY is required to generate scoped keys");
    const embedded: Json = {};
    if (params.filterBy) embedded.filter_by = params.filterBy;
    if (params.expiresAt) embedded.expires_at = params.expiresAt;
    return this.c.keys().generateScopedSearchKey(base, embedded);
  }

  /** Tạo key search-only giới hạn theo collection pattern (chạy một lần lúc setup). */
  async createSearchOnlyKey(
    collections: string[] = ["*"],
    description = "search-only",
  ): Promise<string> {
    const r = await wrap<{ value: string }>(
      this.c.keys().create({ description, actions: ["documents:search"], collections }),
      "createKey",
    );
    return r.value;
  }
}
