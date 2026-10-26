import { useMemo, useRef, useState } from "react";
import { translator, type Locale, type MessageKey } from "../i18n";
import {
  FILTER_SOURCES,
  type FilterDisplay,
  type FilterItem,
  type FilterSource,
} from "../lib/config/filters";
import type { FiltersForm } from "../lib/admin/filters.server";
import type { MetafieldDef } from "./SearchView";
import { SaveBar } from "./SaveBar";

// Trang Filters (task 3.4): dựng cây filter cho mặc định / trang search / từng collection. Save Bar, lỗi inline.
// Bố cục: danh sách gọn (bật/tắt, tên, tóm tắt, sắp xếp) + modal "Sửa filter" chứa mọi chi tiết; bản dịch nằm riêng
// trong modal, chỉ hiện khi shop có thêm ngôn ngữ (phản hồi người dùng: trang trải mọi trường ra quá rối).

export type FiltersViewProps = {
  locale: Locale;
  locales: string[];
  initial: FiltersForm;
  metafieldDefs: MetafieldDef[];
  collectionTitles: Record<string, string>;
  saving: boolean;
  errors: Record<string, string>;
  onSave: (form: FiltersForm) => void;
  onPickCollections: () => Promise<{ id: string; title: string }[]>;
};

/** Kiểu hiển thị hợp lệ theo nguồn (khớp FilterItemSchema). */
export function displaysFor(source: FilterSource, metafieldType?: string): FilterDisplay[] {
  if (source === "price") return ["range"];
  if (source === "availability" || source === "on_sale") return ["toggle"];
  if (source === "metafield" && metafieldType && /number|rating/.test(metafieldType))
    return ["range", "checkbox", "radio"];
  if (source === "option" || source === "metafield" || source === "tags")
    return ["checkbox", "radio", "swatch"];
  return ["checkbox", "radio"];
}

const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;
const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;

type Scope = { kind: "default" } | { kind: "search" } | { kind: "collection"; id: string };
type ModalEl = HTMLElementTagNameMap["s-modal"];
const LIST_DISPLAYS = new Set<FilterDisplay>(["checkbox", "radio", "swatch"]);

function newItem(source: FilterSource, existing: FilterItem[], label: string): FilterItem {
  let id: string = source;
  for (let n = 2; existing.some((x) => x.id === id); n++) id = `${source}_${n}`;
  return {
    id,
    source,
    label: { en: label },
    display: displaysFor(source)[0],
    enabled: true,
    position: existing.length,
    collapsed: false,
    showCount: source !== "price",
    maxValues: 20,
    sortValues: "count",
    matchAll: false,
  };
}

export function FiltersView(p: FiltersViewProps) {
  const t = translator(p.locale);
  const [f, setF] = useState<FiltersForm>(p.initial);
  const [prevInitial, setPrevInitial] = useState(p.initial);
  if (prevInitial !== p.initial) {
    setPrevInitial(p.initial);
    setF(p.initial);
  }
  const [scope, setScope] = useState<Scope>({ kind: "default" });
  const [titles, setTitles] = useState(p.collectionTitles);
  // Modal sửa: bản nháp + vị trí (-1 = filter mới). Chỉ ghi vào form khi bấm "Xong".
  const modal = useRef<ModalEl>(null);
  const [draft, setDraft] = useState<FilterItem | null>(null);
  const [editing, setEditing] = useState(-1);
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(p.initial), [f, p.initial]);
  // "en" là tên mặc định (dùng cho mọi ngôn ngữ chưa dịch); ngôn ngữ khác của shop là bản dịch tuỳ chọn.
  const translations = [...new Set(p.locales)].filter((l) => l !== "en").slice(0, 3);

  const prefix =
    scope.kind === "default"
      ? "default"
      : scope.kind === "search"
        ? "search"
        : `collections.${scope.id}`;
  const items: FilterItem[] | null =
    scope.kind === "default"
      ? f.default
      : scope.kind === "search"
        ? f.search
        : (f.collections[scope.id] ?? []);
  const setItems = (next: FilterItem[] | null) => {
    if (scope.kind === "default") setF({ ...f, default: next ?? [] });
    else if (scope.kind === "search") setF({ ...f, search: next });
    else setF({ ...f, collections: { ...f.collections, [scope.id]: next ?? [] } });
  };
  const setItem = (i: number, patch: Partial<FilterItem>) =>
    items && setItems(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const move = (from: number, to: number) => {
    if (!items || to < 0 || to >= items.length) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setItems(next.map((it, k) => ({ ...it, position: k })));
  };
  const nameOf = (it: FilterItem) => it.label[p.locale] || it.label.en || it.id;
  const mfTypeOf = (it: FilterItem) =>
    it.source === "metafield"
      ? p.metafieldDefs.find((d) => `${d.namespace}.${d.key}` === it.metafield)?.type
      : undefined;
  const summary = (it: FilterItem) => {
    const parts = [
      it.source === "option" && it.optionName
        ? it.optionName
        : it.source === "metafield" && it.metafield
          ? it.metafield
          : t(`filters.src.${it.source}` as MessageKey),
      t(`filters.disp.${it.display}` as MessageKey),
    ];
    if (LIST_DISPLAYS.has(it.display)) parts.push(t("filters.summary.values", { n: it.maxValues }));
    if (it.collapsed) parts.push(t("filters.summary.collapsed"));
    return parts.join(" · ");
  };
  const errorsFor = (i: number) =>
    Object.entries(p.errors).filter(
      ([k]) => k === `${prefix}.${i}` || k.startsWith(`${prefix}.${i}.`),
    );
  const err = (field: string) =>
    editing >= 0 ? p.errors[`${prefix}.${editing}.${field}`] : undefined;

  const openEdit = (i: number) => {
    setEditing(i);
    setDraft({ ...items![i], label: { ...items![i].label } });
    modal.current?.showOverlay();
  };
  const openAdd = () => {
    setEditing(-1);
    setDraft(newItem("vendor", items ?? [], t("filters.src.vendor")));
    modal.current?.showOverlay();
  };
  const commit = () => {
    if (!draft) return;
    if (editing < 0) setItems([...(items ?? []), { ...draft, position: (items ?? []).length }]);
    else setItem(editing, draft);
    modal.current?.hideOverlay();
  };
  const patchDraft = (patch: Partial<FilterItem>) => draft && setDraft({ ...draft, ...patch });

  const scopeValue = scope.kind === "collection" ? `c:${scope.id}` : scope.kind;
  // Lỗi hiển thị theo tên filter (không phải đường dẫn kỹ thuật như "default.2.optionName").
  const errorList = Object.entries(p.errors).map(([k, v]) => {
    const m = /^(default|search|collections\.([^.]+))\.(\d+)/.exec(k);
    const list = !m
      ? null
      : m[1] === "default"
        ? f.default
        : m[1] === "search"
          ? f.search
          : f.collections[m[2]];
    const it = m && list ? list[Number(m[3])] : undefined;
    return it ? `${nameOf(it)}: ${v}` : v;
  });

  return (
    <s-page heading={t("filters.title")} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.home")}
      </s-link>
      <s-button
        slot="secondary-actions"
        onClick={async () => {
          const picked = await p.onPickCollections();
          if (!picked.length) return;
          setTitles({ ...titles, ...Object.fromEntries(picked.map((c) => [c.id, c.title])) });
          const collections = { ...f.collections };
          for (const c of picked) collections[c.id] ??= f.default.map((x) => ({ ...x }));
          setF({ ...f, collections });
          setScope({ kind: "collection", id: picked[0].id });
        }}
      >
        {t("filters.addOverride")}
      </s-button>
      <SaveBar
        id="filters-save-bar"
        dirty={dirty}
        saving={p.saving}
        onSave={() => p.onSave(f)}
        onDiscard={() => setF(p.initial)}
        labels={{ save: t("common.save"), discard: t("common.discard") }}
      />
      {errorList.length > 0 && (
        <s-banner slot="supplemental-start" tone="critical" heading={t("common.errorSaving")}>
          <s-unordered-list>
            {errorList.map((e) => (
              <s-list-item key={e}>{e}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="end">
            <s-select
              label={t("filters.scope")}
              value={scopeValue}
              onChange={(e) => {
                const v = value(e);
                setScope(
                  v.startsWith("c:")
                    ? { kind: "collection", id: v.slice(2) }
                    : ({ kind: v } as Scope),
                );
              }}
            >
              <s-option value="default">{t("filters.scope.default")}</s-option>
              <s-option value="search">{t("filters.scope.search")}</s-option>
              {Object.keys(f.collections).map((id) => (
                <s-option key={id} value={`c:${id}`}>
                  {t("filters.scope.collection", { title: titles[id] ?? id })}
                </s-option>
              ))}
            </s-select>
            {scope.kind === "search" && f.search && (
              <s-button onClick={() => setItems(null)}>{t("filters.scope.useDefault")}</s-button>
            )}
            {scope.kind === "collection" && (
              <s-button
                tone="critical"
                variant="tertiary"
                onClick={() => {
                  const collections = { ...f.collections };
                  delete collections[scope.id];
                  setF({ ...f, collections });
                  setScope({ kind: "default" });
                }}
              >
                {t("filters.removeOverride")}
              </s-button>
            )}
          </s-stack>
          <s-text color="subdued">{t(`filters.scope.${scope.kind}.desc` as MessageKey)}</s-text>
        </s-stack>
      </s-section>

      {scope.kind === "search" && !f.search ? (
        <s-section>
          <s-stack direction="block" gap="small-200">
            <s-paragraph>{t("filters.scope.searchInherit")}</s-paragraph>
            <s-button onClick={() => setF({ ...f, search: f.default.map((x) => ({ ...x })) })}>
              {t("filters.scope.searchCustomize")}
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section heading={t("filters.items.heading")}>
          <s-button slot="secondary-actions" onClick={openAdd}>
            {t("filters.add")}
          </s-button>
          <s-stack direction="block" gap="small-200">
            {(items ?? []).length === 0 && <s-paragraph>{t("filters.items.empty")}</s-paragraph>}
            {(items ?? []).map((it, i) => (
              <s-box key={it.id} padding="small-200" borderWidth="base" borderRadius="base">
                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <s-switch
                      label={nameOf(it)}
                      labelAccessibilityVisibility="exclusive"
                      checked={it.enabled}
                      onChange={(e) => setItem(i, { enabled: checked(e) })}
                    />
                    <s-stack direction="block" gap="small-500">
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-text type="strong">{nameOf(it)}</s-text>
                        {!it.enabled && <s-badge>{t("filters.hidden")}</s-badge>}
                        {errorsFor(i).length > 0 && (
                          <s-badge tone="critical">{t("filters.needsAttention")}</s-badge>
                        )}
                      </s-stack>
                      <s-text color="subdued">{summary(it)}</s-text>
                    </s-stack>
                  </s-stack>
                  <s-button-group>
                    <s-button
                      slot="secondary-actions"
                      icon="arrow-up"
                      accessibilityLabel={`${t("sorting.moveUp")}: ${nameOf(it)}`}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    />
                    <s-button
                      slot="secondary-actions"
                      icon="arrow-down"
                      accessibilityLabel={`${t("sorting.moveDown")}: ${nameOf(it)}`}
                      disabled={i === (items?.length ?? 1) - 1}
                      onClick={() => move(i, i + 1)}
                    />
                    <s-button slot="secondary-actions" onClick={() => openEdit(i)}>
                      {t("common.edit")}
                    </s-button>
                    <s-button
                      slot="secondary-actions"
                      icon="delete"
                      tone="critical"
                      accessibilityLabel={`${t("common.remove")}: ${nameOf(it)}`}
                      onClick={() => setItems((items ?? []).filter((_, k) => k !== i))}
                    />
                  </s-button-group>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-modal
        ref={modal}
        id="filter-modal"
        heading={editing < 0 ? t("filters.addTitle") : t("filters.editTitle")}
        size="base"
      >
        {draft && (
          <s-stack direction="block" gap="base">
            <s-text-field
              label={t("filters.name")}
              details={translations.length ? t("filters.name.details") : undefined}
              value={draft.label.en ?? ""}
              error={err("label")}
              onChange={(e) => patchDraft({ label: { ...draft.label, en: value(e) } })}
            />
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="small-200">
              <s-select
                label={t("filters.source")}
                value={draft.source}
                onChange={(e) => {
                  const source = value(e) as FilterSource;
                  patchDraft({
                    source,
                    display: displaysFor(source)[0],
                    showCount: source !== "price",
                  });
                }}
              >
                {FILTER_SOURCES.map((s) => (
                  <s-option key={s} value={s}>
                    {t(`filters.src.${s}` as MessageKey)}
                  </s-option>
                ))}
              </s-select>
              <s-select
                label={t("filters.display")}
                value={draft.display}
                error={err("display")}
                onChange={(e) => patchDraft({ display: value(e) as FilterDisplay })}
              >
                {displaysFor(draft.source, mfTypeOf(draft)).map((d) => (
                  <s-option key={d} value={d}>
                    {t(`filters.disp.${d}` as MessageKey)}
                  </s-option>
                ))}
              </s-select>
            </s-grid>
            {draft.source === "option" && (
              <s-text-field
                label={t("filters.optionName")}
                details={t("filters.optionName.help")}
                value={draft.optionName ?? ""}
                error={err("optionName")}
                onChange={(e) => patchDraft({ optionName: value(e) })}
              />
            )}
            {draft.source === "metafield" && (
              <s-select
                label={t("filters.metafield")}
                placeholder={t("search.addMetafield.placeholder")}
                value={draft.metafield ?? ""}
                error={err("metafield")}
                onChange={(e) => patchDraft({ metafield: value(e) })}
              >
                {p.metafieldDefs.map((d) => (
                  <s-option key={`${d.namespace}.${d.key}`} value={`${d.namespace}.${d.key}`}>
                    {`${d.name} (${d.namespace}.${d.key})`}
                  </s-option>
                ))}
              </s-select>
            )}
            {draft.source === "tags" && (
              <s-text-field
                label={t("filters.tagPrefix")}
                details={t("filters.tagPrefix.help")}
                value={draft.tagPrefix ?? ""}
                onChange={(e) => patchDraft({ tagPrefix: value(e) || undefined })}
              />
            )}
            {LIST_DISPLAYS.has(draft.display) && (
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="small-200">
                <s-number-field
                  label={t("filters.maxValues")}
                  details={t("filters.maxValues.details")}
                  value={String(draft.maxValues)}
                  min={1}
                  max={250}
                  inputMode="numeric"
                  onChange={(e) =>
                    patchDraft({ maxValues: Math.max(1, Math.min(250, Number(value(e)) || 20)) })
                  }
                />
                <s-select
                  label={t("filters.sortValues")}
                  value={draft.sortValues}
                  onChange={(e) => patchDraft({ sortValues: value(e) as FilterItem["sortValues"] })}
                >
                  <s-option value="count">{t("filters.sortValues.count")}</s-option>
                  <s-option value="alpha">{t("filters.sortValues.alpha")}</s-option>
                </s-select>
              </s-grid>
            )}
            <s-stack direction="block" gap="small-200">
              <s-checkbox
                label={t("filters.collapsed")}
                checked={draft.collapsed}
                onChange={(e) => patchDraft({ collapsed: checked(e) })}
              />
              {draft.display !== "range" && (
                <s-checkbox
                  label={t("filters.showCount")}
                  checked={draft.showCount}
                  onChange={(e) => patchDraft({ showCount: checked(e) })}
                />
              )}
              {(draft.display === "checkbox" || draft.display === "swatch") && (
                <s-checkbox
                  label={t("filters.matchAll")}
                  details={t("filters.matchAll.details")}
                  checked={draft.matchAll}
                  onChange={(e) => patchDraft({ matchAll: checked(e) })}
                />
              )}
            </s-stack>
            {translations.length > 0 && (
              <s-stack direction="block" gap="small-200">
                <s-heading>{t("filters.translations")}</s-heading>
                <s-paragraph color="subdued">{t("filters.translations.desc")}</s-paragraph>
                {translations.map((l) => (
                  <s-text-field
                    key={l}
                    label={t("sorting.label", { locale: l })}
                    placeholder={draft.label.en ?? ""}
                    value={draft.label[l] ?? ""}
                    onChange={(e) => patchDraft({ label: { ...draft.label, [l]: value(e) } })}
                  />
                ))}
              </s-stack>
            )}
          </s-stack>
        )}
        <s-button slot="primary-action" variant="primary" onClick={commit}>
          {editing < 0 ? t("filters.add") : t("filters.done")}
        </s-button>
        <s-button slot="secondary-actions" onClick={() => modal.current?.hideOverlay()}>
          {t("common.cancel")}
        </s-button>
      </s-modal>
    </s-page>
  );
}
