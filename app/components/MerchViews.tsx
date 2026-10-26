import { useEffect, useRef, useState } from "react";
import { translator, type Locale, type MessageKey } from "../i18n";
import type { MerchLists, MerchMutation, MerchType } from "../lib/admin/merch.server";
import type { MerchActions, MerchCondition } from "../lib/merch/engine-sync.server";

// Merchandising (task 3.5, mục 8): s-table, empty state, s-modal cho thêm/sửa/xoá. Mỗi thay đổi lưu ngay
// (nút Lưu trong modal) rồi đẩy sang engine — không có form trang dài nên không cần Save Bar trang.

type ModalEl = HTMLElementTagNameMap["s-modal"];

const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;
const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
const splitTerms = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function MerchIndexView({
  locale,
  counts,
}: {
  locale: Locale;
  counts: Record<MerchType, number>;
}) {
  const t = translator(locale);
  return (
    <s-page heading={t("merch.title")} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.home")}
      </s-link>
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
        {(["synonyms", "redirects", "rules", "stopwords"] as const).map((type) => (
          <s-section key={type} heading={t(`merch.${type}` as MessageKey)}>
            <s-stack direction="block" gap="small-200">
              <s-paragraph color="subdued">{t(`merch.${type}.desc` as MessageKey)}</s-paragraph>
              <s-stack
                direction="inline"
                gap="small-200"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-badge>{String(counts[type])}</s-badge>
                <s-button href={`/app/merchandising/${type}`}>{t("merch.manage")}</s-button>
              </s-stack>
            </s-stack>
          </s-section>
        ))}
      </s-grid>
    </s-page>
  );
}

export type ProductRef = { id: string; title: string };

export type MerchListViewProps = {
  locale: Locale;
  type: MerchType;
  lists: MerchLists;
  /** id → tên (sản phẩm/collection trong rule). */
  names: Record<string, string>;
  busy: boolean;
  errors: Record<string, string>;
  /** Kết quả lưu thành công mới nhất (đổi identity mỗi lần) → đóng modal. */
  saved: unknown;
  /** Mở sẵn modal thêm với giá trị gợi ý (từ Analytics: ?new=query). */
  prefill?: string;
  onMutate: (m: MerchMutation) => void;
  onPickProducts: () => Promise<ProductRef[]>;
  onPickCollection: () => Promise<ProductRef | null>;
};

type Draft = Record<string, unknown> & { id?: string };

function emptyDraft(type: MerchType, prefill = ""): Draft {
  switch (type) {
    case "synonyms":
      return { type: "multi", root: prefill, terms: prefill };
    case "redirects":
      return { query: prefill, url: "" };
    case "stopwords":
      return { word: prefill, locale: "en" };
    case "rules":
      return {
        name: prefill,
        enabled: true,
        condition: { query: prefill, match: "exact" } as MerchCondition,
        actions: { pin: [], hide: [], boost: [] } as MerchActions,
        startsAt: null,
        endsAt: null,
      };
  }
}

export function MerchListView(p: MerchListViewProps) {
  const t = translator(p.locale);
  const modal = useRef<ModalEl>(null);
  const confirm = useRef<ModalEl>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(p.type, p.prefill));
  const [deleting, setDeleting] = useState<string | null>(null);
  const [names, setNames] = useState(p.names);
  const err = (k: string) => p.errors[k];

  useEffect(() => {
    if (p.prefill) modal.current?.showOverlay();
  }, [p.prefill]);
  useEffect(() => {
    if (p.saved) {
      modal.current?.hideOverlay();
      confirm.current?.hideOverlay();
    }
  }, [p.saved]);

  const open = (d: Draft) => {
    setDraft(d);
    modal.current?.showOverlay();
  };
  const save = () => {
    const { id, ...rest } = draft;
    const data =
      p.type === "synonyms"
        ? {
            type: rest.type,
            root: rest.type === "one_way" ? rest.root : undefined,
            terms: splitTerms(String(rest.terms ?? "")),
          }
        : rest;
    p.onMutate({ op: "upsert", type: p.type, id, data });
  };

  const rows: { id: string; cells: string[]; draft: Draft; enabled?: boolean }[] = (() => {
    switch (p.type) {
      case "synonyms":
        return p.lists.synonyms.map((s) => ({
          id: s.id,
          cells: [
            s.type === "one_way" ? `${s.root} → ${s.terms.join(", ")}` : s.terms.join(" = "),
            t(s.type === "one_way" ? "merch.synonym.one_way" : "merch.synonym.multi"),
          ],
          draft: { id: s.id, type: s.type, root: s.root ?? "", terms: s.terms.join(", ") },
        }));
      case "redirects":
        return p.lists.redirects.map((r) => ({
          id: r.id,
          cells: [r.query, r.url],
          draft: { id: r.id, query: r.query, url: r.url },
        }));
      case "stopwords":
        return p.lists.stopwords.map((w) => ({
          id: w.id,
          cells: [w.word, w.locale],
          draft: { id: w.id, word: w.word, locale: w.locale },
        }));
      case "rules":
        return p.lists.rules.map((r) => {
          const c = r.condition as MerchCondition;
          const a = r.actions as MerchActions;
          const when = c.collectionId
            ? `${t("merch.rule.collection")}: ${names[c.collectionId] ?? c.collectionId}`
            : `“${c.query}” (${t(c.match === "contains" ? "merch.rule.contains" : "merch.rule.exact")})`;
          const what = [
            a.pin?.length ? `${t("merch.rule.pin")}: ${a.pin.length}` : "",
            a.hide?.length ? `${t("merch.rule.hide")}: ${a.hide.length}` : "",
            a.boost?.length ? `${t("merch.rule.boost")}: ${a.boost.length}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return {
            id: r.id,
            cells: [r.name, when, what],
            enabled: r.enabled,
            draft: {
              id: r.id,
              name: r.name,
              enabled: r.enabled,
              condition: c,
              actions: { pin: a.pin ?? [], hide: a.hide ?? [], boost: a.boost ?? [] },
              startsAt: r.startsAt,
              endsAt: r.endsAt,
            },
          };
        });
    }
  })();

  const headers: MessageKey[] =
    p.type === "synonyms"
      ? ["merch.synonym.terms", "merch.synonym.type"]
      : p.type === "redirects"
        ? ["merch.redirect.query", "merch.redirect.url"]
        : p.type === "stopwords"
          ? ["merch.stopword.word", "merch.stopword.locale"]
          : ["merch.rule.name", "merch.rule.when", "merch.col.summary"];

  const cond = (draft.condition ?? {}) as MerchCondition;
  const acts = (draft.actions ?? { pin: [], hide: [], boost: [] }) as MerchActions;
  const setCond = (patch: Partial<MerchCondition>) =>
    setDraft({ ...draft, condition: { ...cond, ...patch } });
  const setActs = (patch: Partial<MerchActions>) =>
    setDraft({ ...draft, actions: { ...acts, ...patch } });

  return (
    <s-page heading={t(`merch.${p.type}` as MessageKey)} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/merchandising">
        {t("merch.title")}
      </s-link>
      <s-button slot="primary-action" variant="primary" onClick={() => open(emptyDraft(p.type))}>
        {t("merch.add")}
      </s-button>

      <s-section padding="none">
        {rows.length === 0 ? (
          <s-empty-state heading={t("merch.empty")}>
            <s-paragraph>{t(`merch.${p.type}.desc` as MessageKey)}</s-paragraph>
            <s-button slot="primary-action" onClick={() => open(emptyDraft(p.type))}>
              {t("merch.add")}
            </s-button>
          </s-empty-state>
        ) : (
          <s-table variant="auto" loading={p.busy}>
            <s-table-header-row>
              {headers.map((h, i) => (
                <s-table-header key={h} listSlot={i === 0 ? "primary" : "labeled"}>
                  {t(h)}
                </s-table-header>
              ))}
              <s-table-header listSlot="labeled">{""}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => (
                <s-table-row key={r.id}>
                  {r.cells.map((c, i) => (
                    <s-table-cell key={i}>
                      {i === 0 && r.enabled === false ? (
                        <s-stack direction="inline" gap="small-200">
                          <s-text>{c}</s-text>
                          <s-badge>{t("common.disabled")}</s-badge>
                        </s-stack>
                      ) : (
                        c
                      )}
                    </s-table-cell>
                  ))}
                  <s-table-cell>
                    <s-button-group>
                      <s-button slot="secondary-actions" onClick={() => open(r.draft)}>
                        {t("merch.edit")}
                      </s-button>
                      <s-button
                        slot="secondary-actions"
                        tone="critical"
                        onClick={() => {
                          setDeleting(r.id);
                          confirm.current?.showOverlay();
                        }}
                      >
                        {t("common.delete")}
                      </s-button>
                    </s-button-group>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-modal
        ref={modal}
        id="merch-modal"
        heading={draft.id ? t("merch.edit") : t("merch.add")}
        size="base"
      >
        <s-stack direction="block" gap="base">
          {p.type === "synonyms" && (
            <>
              <s-select
                label={t("merch.synonym.type")}
                value={String(draft.type)}
                onChange={(e) => setDraft({ ...draft, type: value(e) })}
              >
                <s-option value="multi">{t("merch.synonym.multi")}</s-option>
                <s-option value="one_way">{t("merch.synonym.one_way")}</s-option>
              </s-select>
              {draft.type === "one_way" && (
                <s-text-field
                  label={t("merch.synonym.root")}
                  value={String(draft.root ?? "")}
                  error={err("root")}
                  onChange={(e) => setDraft({ ...draft, root: value(e) })}
                />
              )}
              <s-text-field
                label={
                  draft.type === "one_way" ? t("merch.synonym.alsoShow") : t("merch.synonym.terms")
                }
                value={String(draft.terms ?? "")}
                error={err("terms")}
                onChange={(e) => setDraft({ ...draft, terms: value(e) })}
              />
            </>
          )}
          {p.type === "redirects" && (
            <>
              <s-text-field
                label={t("merch.redirect.query")}
                value={String(draft.query ?? "")}
                error={err("query")}
                onChange={(e) => setDraft({ ...draft, query: value(e) })}
              />
              <s-text-field
                label={t("merch.redirect.url")}
                details={t("merch.redirect.url.help")}
                value={String(draft.url ?? "")}
                error={err("url")}
                onChange={(e) => setDraft({ ...draft, url: value(e) })}
              />
            </>
          )}
          {p.type === "stopwords" && (
            <>
              <s-text-field
                label={t("merch.stopword.word")}
                value={String(draft.word ?? "")}
                error={err("word")}
                onChange={(e) => setDraft({ ...draft, word: value(e) })}
              />
              <s-text-field
                label={t("merch.stopword.locale")}
                value={String(draft.locale ?? "en")}
                error={err("locale")}
                onChange={(e) => setDraft({ ...draft, locale: value(e) })}
              />
            </>
          )}
          {p.type === "rules" && (
            <>
              <s-text-field
                label={t("merch.rule.name")}
                value={String(draft.name ?? "")}
                error={err("name")}
                onChange={(e) => setDraft({ ...draft, name: value(e) })}
              />
              <s-switch
                label={t("merch.rule.enabled")}
                checked={Boolean(draft.enabled)}
                onChange={(e) => setDraft({ ...draft, enabled: checked(e) })}
              />
              <s-select
                label={t("merch.rule.when")}
                value={cond.collectionId ? "collection" : "query"}
                error={err("condition")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    condition:
                      value(e) === "collection"
                        ? { match: "exact", collectionId: cond.collectionId }
                        : { query: cond.query ?? "", match: cond.match ?? "exact" },
                  })
                }
              >
                <s-option value="query">{t("merch.rule.whenQuery")}</s-option>
                <s-option value="collection">{t("merch.rule.whenCollection")}</s-option>
              </s-select>
              {cond.collectionId !== undefined ||
              (draft.condition as MerchCondition)?.query === undefined ? (
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text>
                    {cond.collectionId ? (names[cond.collectionId] ?? cond.collectionId) : "—"}
                  </s-text>
                  <s-button
                    onClick={async () => {
                      const c = await p.onPickCollection();
                      if (c) {
                        setNames({ ...names, [c.id]: c.title });
                        setCond({ collectionId: c.id, query: undefined });
                      }
                    }}
                  >
                    {t("merch.rule.pickCollection")}
                  </s-button>
                </s-stack>
              ) : (
                <s-grid gridTemplateColumns="2fr 1fr" gap="small-200">
                  <s-text-field
                    label={t("merch.rule.query")}
                    value={cond.query ?? ""}
                    error={err("condition.query")}
                    onChange={(e) => setCond({ query: value(e) })}
                  />
                  <s-select
                    label={t("merch.rule.match")}
                    value={cond.match ?? "exact"}
                    onChange={(e) => setCond({ match: value(e) as MerchCondition["match"] })}
                  >
                    <s-option value="exact">{t("merch.rule.exact")}</s-option>
                    <s-option value="contains">{t("merch.rule.contains")}</s-option>
                  </s-select>
                </s-grid>
              )}
              {err("actions") && <s-text tone="critical">{err("actions")}</s-text>}
              <s-stack direction="block" gap="small-200">
                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-heading>{t("merch.rule.pin")}</s-heading>
                  <s-button
                    onClick={async () => {
                      const picked = await p.onPickProducts();
                      setNames({
                        ...names,
                        ...Object.fromEntries(picked.map((x) => [x.id, x.title])),
                      });
                      const pin = [...acts.pin];
                      for (const x of picked)
                        if (!pin.some((y) => y.productId === x.id))
                          pin.push({ productId: x.id, position: pin.length + 1 });
                      setActs({ pin });
                    }}
                  >
                    {t("merch.rule.pickProducts")}
                  </s-button>
                </s-stack>
                {acts.pin.map((x, i) => (
                  <s-stack key={x.productId} direction="inline" gap="small-200" alignItems="end">
                    <s-number-field
                      label={`${t("merch.rule.position")}: ${names[x.productId] ?? x.productId}`}
                      value={String(x.position)}
                      min={1}
                      max={250}
                      inputMode="numeric"
                      onChange={(e) =>
                        setActs({
                          pin: acts.pin.map((y, k) =>
                            k === i ? { ...y, position: Math.max(1, Number(value(e)) || 1) } : y,
                          ),
                        })
                      }
                    />
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => setActs({ pin: acts.pin.filter((_, k) => k !== i) })}
                    >
                      {t("common.remove")}
                    </s-button>
                  </s-stack>
                ))}
              </s-stack>
              <s-stack direction="block" gap="small-200">
                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-heading>{t("merch.rule.hide")}</s-heading>
                  <s-button
                    onClick={async () => {
                      const picked = await p.onPickProducts();
                      setNames({
                        ...names,
                        ...Object.fromEntries(picked.map((x) => [x.id, x.title])),
                      });
                      setActs({ hide: [...new Set([...acts.hide, ...picked.map((x) => x.id)])] });
                    }}
                  >
                    {t("merch.rule.pickProducts")}
                  </s-button>
                </s-stack>
                {acts.hide.map((id) => (
                  <s-stack key={id} direction="inline" gap="small-200" alignItems="center">
                    <s-text>{names[id] ?? id}</s-text>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => setActs({ hide: acts.hide.filter((x) => x !== id) })}
                    >
                      {t("common.remove")}
                    </s-button>
                  </s-stack>
                ))}
              </s-stack>
              <s-stack direction="block" gap="small-200">
                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-heading>{t("merch.rule.boost")}</s-heading>
                  <s-button
                    onClick={() =>
                      setActs({ boost: [...acts.boost, { field: "vendor", value: "", weight: 3 }] })
                    }
                  >
                    {t("merch.rule.addBoost")}
                  </s-button>
                </s-stack>
                {acts.boost.map((b, i) => (
                  <s-grid
                    key={i}
                    gridTemplateColumns="1fr 1fr 1fr auto"
                    gap="small-200"
                    alignItems="end"
                  >
                    <s-select
                      label={t("merch.rule.boost.field")}
                      value={b.field}
                      onChange={(e) =>
                        setActs({
                          boost: acts.boost.map((x, k) =>
                            k === i ? { ...x, field: value(e) as typeof b.field } : x,
                          ),
                        })
                      }
                    >
                      <s-option value="vendor">{t("field.vendor")}</s-option>
                      <s-option value="product_type">{t("field.product_type")}</s-option>
                      <s-option value="tags">{t("field.tags")}</s-option>
                      <s-option value="collections">{t("merch.rule.collection")}</s-option>
                    </s-select>
                    <s-text-field
                      label={t("merch.rule.boost.value")}
                      value={b.value}
                      error={err(`actions.boost.${i}.value`)}
                      onChange={(e) =>
                        setActs({
                          boost: acts.boost.map((x, k) =>
                            k === i ? { ...x, value: value(e) } : x,
                          ),
                        })
                      }
                    />
                    <s-number-field
                      label={t("merch.rule.boost.weight")}
                      value={String(b.weight)}
                      min={-10}
                      max={10}
                      inputMode="numeric"
                      onChange={(e) =>
                        setActs({
                          boost: acts.boost.map((x, k) =>
                            k === i
                              ? {
                                  ...x,
                                  weight: Math.max(
                                    -10,
                                    Math.min(10, Math.round(Number(value(e)) || 0)),
                                  ),
                                }
                              : x,
                          ),
                        })
                      }
                    />
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => setActs({ boost: acts.boost.filter((_, k) => k !== i) })}
                    >
                      {t("common.remove")}
                    </s-button>
                  </s-grid>
                ))}
              </s-stack>
              <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
                <s-date-field
                  label={t("merch.rule.start")}
                  value={draft.startsAt ? String(draft.startsAt).slice(0, 10) : ""}
                  onChange={(e) =>
                    setDraft({ ...draft, startsAt: value(e) ? `${value(e)}T00:00:00.000Z` : null })
                  }
                />
                <s-date-field
                  label={t("merch.rule.end")}
                  value={draft.endsAt ? String(draft.endsAt).slice(0, 10) : ""}
                  error={err("endsAt")}
                  onChange={(e) =>
                    setDraft({ ...draft, endsAt: value(e) ? `${value(e)}T23:59:59.000Z` : null })
                  }
                />
              </s-grid>
            </>
          )}
        </s-stack>
        <s-button slot="primary-action" variant="primary" loading={p.busy} onClick={save}>
          {t("common.save")}
        </s-button>
        <s-button slot="secondary-actions" onClick={() => modal.current?.hideOverlay()}>
          {t("common.cancel")}
        </s-button>
      </s-modal>

      <s-modal ref={confirm} id="merch-delete" heading={t("merch.delete.confirm")}>
        <s-paragraph>{t("merch.delete.desc")}</s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={p.busy}
          onClick={() => deleting && p.onMutate({ op: "delete", type: p.type, id: deleting })}
        >
          {t("common.delete")}
        </s-button>
        <s-button slot="secondary-actions" onClick={() => confirm.current?.hideOverlay()}>
          {t("common.cancel")}
        </s-button>
      </s-modal>
    </s-page>
  );
}
