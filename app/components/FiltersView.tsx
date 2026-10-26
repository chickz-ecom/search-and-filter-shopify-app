import { useMemo, useState } from "react";
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
  const [newSource, setNewSource] = useState<FilterSource>("vendor");
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(p.initial), [f, p.initial]);
  const locales = [...new Set(["en", ...p.locales])].slice(0, 4);

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
  const add = () => {
    const base = items ?? [];
    let id: string = newSource;
    for (let n = 2; base.some((x) => x.id === id); n++) id = `${newSource}_${n}`;
    const display = displaysFor(newSource)[0];
    setItems([
      ...base,
      {
        id,
        source: newSource,
        label: { en: t(`filters.src.${newSource}` as MessageKey) },
        display,
        enabled: true,
        position: base.length,
        collapsed: false,
        showCount: newSource !== "price",
        maxValues: 20,
        sortValues: "count",
        matchAll: false,
      },
    ]);
  };
  const scopeValue = scope.kind === "collection" ? `c:${scope.id}` : scope.kind;
  const err = (path: string) => p.errors[path];
  const anyError = Object.keys(p.errors).length > 0;

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
      {anyError && (
        <s-banner slot="supplemental-start" tone="critical" heading={t("common.errorSaving")}>
          <s-unordered-list>
            {Object.entries(p.errors).map(([k, v]) => (
              <s-list-item key={k}>{`${k}: ${v}`}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <s-section>
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
          <s-stack direction="block" gap="small-200">
            {(items ?? []).length === 0 && <s-paragraph>{t("filters.items.empty")}</s-paragraph>}
            {(items ?? []).map((it, i) => {
              const mfType =
                it.source === "metafield"
                  ? p.metafieldDefs.find((d) => `${d.namespace}.${d.key}` === it.metafield)?.type
                  : undefined;
              const path = `${prefix}.${i}`;
              return (
                <s-box key={it.id} padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small-200">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <s-switch
                        label={it.label[p.locale] ?? it.label.en ?? it.id}
                        checked={it.enabled}
                        onChange={(e) => setItem(i, { enabled: checked(e) })}
                      />
                      <s-button-group>
                        <s-button
                          slot="secondary-actions"
                          icon="arrow-up"
                          accessibilityLabel={`${t("sorting.moveUp")}: ${it.id}`}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        />
                        <s-button
                          slot="secondary-actions"
                          icon="arrow-down"
                          accessibilityLabel={`${t("sorting.moveDown")}: ${it.id}`}
                          disabled={i === (items?.length ?? 1) - 1}
                          onClick={() => move(i, i + 1)}
                        />
                        <s-button
                          slot="secondary-actions"
                          tone="critical"
                          onClick={() => setItems((items ?? []).filter((_, k) => k !== i))}
                        >
                          {t("common.remove")}
                        </s-button>
                      </s-button-group>
                    </s-stack>
                    <s-grid
                      gridTemplateColumns={`repeat(${locales.length}, minmax(0, 1fr))`}
                      gap="small-200"
                    >
                      {locales.map((l) => (
                        <s-text-field
                          key={l}
                          label={t("sorting.label", { locale: l })}
                          value={it.label[l] ?? ""}
                          onChange={(e) => setItem(i, { label: { ...it.label, [l]: value(e) } })}
                        />
                      ))}
                    </s-grid>
                    <s-grid
                      gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
                      gap="small-200"
                    >
                      <s-select
                        label={t("filters.source")}
                        value={it.source}
                        onChange={(e) => {
                          const source = value(e) as FilterSource;
                          setItem(i, { source, display: displaysFor(source)[0] });
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
                        value={it.display}
                        error={err(`${path}.display`)}
                        onChange={(e) => setItem(i, { display: value(e) as FilterDisplay })}
                      >
                        {displaysFor(it.source, mfType).map((d) => (
                          <s-option key={d} value={d}>
                            {t(`filters.disp.${d}` as MessageKey)}
                          </s-option>
                        ))}
                      </s-select>
                      {it.source === "option" && (
                        <s-text-field
                          label={t("filters.optionName")}
                          details={t("filters.optionName.help")}
                          value={it.optionName ?? ""}
                          error={err(`${path}.optionName`)}
                          onChange={(e) => setItem(i, { optionName: value(e) })}
                        />
                      )}
                      {it.source === "metafield" && (
                        <s-select
                          label={t("filters.metafield")}
                          placeholder={t("search.addMetafield.placeholder")}
                          value={it.metafield ?? ""}
                          error={err(`${path}.metafield`)}
                          onChange={(e) => setItem(i, { metafield: value(e) })}
                        >
                          {p.metafieldDefs.map((d) => (
                            <s-option
                              key={`${d.namespace}.${d.key}`}
                              value={`${d.namespace}.${d.key}`}
                            >
                              {`${d.name} (${d.namespace}.${d.key})`}
                            </s-option>
                          ))}
                        </s-select>
                      )}
                      {it.source === "tags" && (
                        <s-text-field
                          label={t("filters.tagPrefix")}
                          details={t("filters.tagPrefix.help")}
                          value={it.tagPrefix ?? ""}
                          onChange={(e) => setItem(i, { tagPrefix: value(e) || undefined })}
                        />
                      )}
                      {it.display !== "range" && it.display !== "toggle" && (
                        <>
                          <s-number-field
                            label={t("filters.maxValues")}
                            value={String(it.maxValues)}
                            min={1}
                            max={250}
                            inputMode="numeric"
                            onChange={(e) =>
                              setItem(i, {
                                maxValues: Math.max(1, Math.min(250, Number(value(e)) || 20)),
                              })
                            }
                          />
                          <s-select
                            label={t("filters.sortValues")}
                            value={it.sortValues}
                            onChange={(e) =>
                              setItem(i, { sortValues: value(e) as FilterItem["sortValues"] })
                            }
                          >
                            <s-option value="count">{t("filters.sortValues.count")}</s-option>
                            <s-option value="alpha">{t("filters.sortValues.alpha")}</s-option>
                          </s-select>
                        </>
                      )}
                    </s-grid>
                    <s-stack direction="inline" gap="base">
                      <s-checkbox
                        label={t("filters.collapsed")}
                        checked={it.collapsed}
                        onChange={(e) => setItem(i, { collapsed: checked(e) })}
                      />
                      {it.display !== "range" && (
                        <s-checkbox
                          label={t("filters.showCount")}
                          checked={it.showCount}
                          onChange={(e) => setItem(i, { showCount: checked(e) })}
                        />
                      )}
                      {(it.display === "checkbox" || it.display === "swatch") && (
                        <s-checkbox
                          label={t("filters.matchAll")}
                          checked={it.matchAll}
                          onChange={(e) => setItem(i, { matchAll: checked(e) })}
                        />
                      )}
                    </s-stack>
                  </s-stack>
                </s-box>
              );
            })}
            <s-stack direction="inline" gap="small-200" alignItems="end">
              <s-select
                label={t("filters.source")}
                value={newSource}
                onChange={(e) => setNewSource(value(e) as FilterSource)}
              >
                {FILTER_SOURCES.map((s) => (
                  <s-option key={s} value={s}>
                    {t(`filters.src.${s}` as MessageKey)}
                  </s-option>
                ))}
              </s-select>
              <s-button onClick={add}>{t("filters.add")}</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
