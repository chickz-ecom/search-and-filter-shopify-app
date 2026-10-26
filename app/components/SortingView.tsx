import { useMemo, useRef, useState } from "react";
import { translator, type Locale, type MessageKey } from "../i18n";
import {
  COLLECTION_ONLY_SORTS,
  isMetafieldSortKey,
  parseMetafieldSortKey,
  QUERY_ONLY_SORTS,
  type SortKey,
  type SortOptionConfig,
} from "../lib/config/sort-options";
import type { SortingForm } from "../lib/admin/sorting.server";
import type { MetafieldDef } from "./SearchView";
import { SaveBar } from "./SaveBar";

// Trang Sorting (task 3.3, mục 8): bật/tắt, nhãn theo locale, kéo thả thứ tự (kèm nút lên/xuống cho bàn phím),
// sort theo metafield, mặc định cho search/collection, ghi đè theo collection (resourcePicker), tie-break.

export type SortingViewProps = {
  locale: Locale;
  locales: string[];
  initial: SortingForm;
  metafieldDefs: MetafieldDef[];
  availability: { bestSelling: boolean };
  collectionTitles: Record<string, string>;
  saving: boolean;
  errors: Record<string, string>;
  onSave: (form: SortingForm) => void;
  onPickCollections: () => Promise<{ id: string; title: string }[]>;
  /** Nguồn xếp hạng bán chạy (task 2.15). */
  bestSelling?: BestSellingInfo;
  busy?: boolean;
  onBestSelling?: (next: {
    source: "storefront" | "orders";
    metric: BestSellingInfo["metric"];
  }) => void;
};

export type BestSellingInfo = {
  source: "storefront" | "orders";
  metric: "quantity" | "orders" | "revenue";
  computedAt: string | null;
  orders: number;
};

type ModalEl = HTMLElementTagNameMap["s-modal"];
/** So sánh tên bỏ qua khác biệt chỉ ở dấu gạch / hoa thường / khoảng trắng ("A-Z" = "A–Z"). */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‐-―−-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
const SORTABLE_MF = new Set(["number_integer", "number_decimal", "rating", "date", "date_time"]);
const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;
const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;

export function SortingView(p: SortingViewProps) {
  const t = translator(p.locale);
  const [f, setF] = useState<SortingForm>(p.initial);
  const [prevInitial, setPrevInitial] = useState(p.initial);
  if (prevInitial !== p.initial) {
    setPrevInitial(p.initial);
    setF(p.initial);
  }
  const [titles, setTitles] = useState(p.collectionTitles);
  const [drag, setDrag] = useState<number | null>(null);
  const [mf, setMf] = useState("");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(p.initial), [f, p.initial]);
  // "en" là tên mặc định; ngôn ngữ khác của shop là bản dịch tuỳ chọn (trong modal Đổi tên).
  const translations = [...new Set(p.locales)].filter((l) => l !== "en").slice(0, 3);
  const err = (path: string) => p.errors[path];
  const renameModal = useRef<ModalEl>(null);
  const [renaming, setRenaming] = useState<{ i: number; label: Record<string, string> } | null>(
    null,
  );

  const name = (o: SortOptionConfig) => {
    if (isMetafieldSortKey(o.key)) {
      const m = parseMetafieldSortKey(o.key);
      const def = p.metafieldDefs.find((d) => d.namespace === m.namespace && d.key === m.key);
      return `${def?.name ?? `${m.namespace}.${m.key}`} (${t(m.direction === "asc" ? "sorting.asc" : "sorting.desc")})`;
    }
    return t(`sort.${o.key}` as MessageKey);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= f.options.length || from === to) return;
    const next = [...f.options];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setF({ ...f, options: next.map((o, i) => ({ ...o, position: i })) });
  };
  const setOpt = (i: number, patch: Partial<SortOptionConfig>) =>
    setF({ ...f, options: f.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const enabled = f.options.filter((o) => o.enabled);
  /** Tên khách thấy (theo ngôn ngữ admin nếu có bản dịch, không thì tên mặc định). */
  const shown = (o: SortOptionConfig) => o.label[p.locale] || o.label.en || name(o);
  const sortableDefs = p.metafieldDefs.filter((d) => SORTABLE_MF.has(d.type));

  return (
    <s-page heading={t("sorting.title")} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.home")}
      </s-link>
      <SaveBar
        id="sorting-save-bar"
        dirty={dirty}
        saving={p.saving}
        onSave={() => p.onSave(f)}
        onDiscard={() => setF(p.initial)}
        labels={{ save: t("common.save"), discard: t("common.discard") }}
      />
      {err("options") && (
        <s-banner slot="supplemental-start" tone="critical" heading={t("common.errorSaving")}>
          <s-paragraph>{err("options")}</s-paragraph>
        </s-banner>
      )}

      <s-section heading={t("sorting.options.heading")}>
        <s-stack direction="block" gap="small-200">
          <s-paragraph color="subdued">
            {t("sorting.options.desc")} {t("sorting.dragHint")}
          </s-paragraph>
          {f.options.map((o, i) => {
            const unavailable = o.key === "best_selling" && !p.availability.bestSelling;
            return (
              <div
                key={o.key}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag !== null) move(drag, i);
                  setDrag(null);
                }}
              >
                <s-box padding="small-200" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small-200">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-icon type="drag-handle" />
                        <s-switch
                          label={shown(o)}
                          checked={o.enabled && !unavailable}
                          disabled={unavailable}
                          onChange={(e) => setOpt(i, { enabled: checked(e) })}
                        />
                        {COLLECTION_ONLY_SORTS.has(o.key) && (
                          <s-badge>{t("sorting.collectionOnly")}</s-badge>
                        )}
                        {QUERY_ONLY_SORTS.has(o.key) && <s-badge>{t("sorting.queryOnly")}</s-badge>}
                        {unavailable && <s-badge tone="warning">{t("sorting.needsData")}</s-badge>}
                      </s-stack>
                      <s-button-group>
                        <s-button
                          slot="secondary-actions"
                          icon="arrow-up"
                          accessibilityLabel={`${t("sorting.moveUp")}: ${name(o)}`}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        />
                        <s-button
                          slot="secondary-actions"
                          icon="arrow-down"
                          accessibilityLabel={`${t("sorting.moveDown")}: ${name(o)}`}
                          disabled={i === f.options.length - 1}
                          onClick={() => move(i, i + 1)}
                        />
                        <s-button
                          slot="secondary-actions"
                          onClick={() => {
                            setRenaming({ i, label: { ...o.label } });
                            renameModal.current?.showOverlay();
                          }}
                        >
                          {t("sorting.rename")}
                        </s-button>
                        {isMetafieldSortKey(o.key) && (
                          <s-button
                            slot="secondary-actions"
                            tone="critical"
                            onClick={() =>
                              setF({ ...f, options: f.options.filter((_, k) => k !== i) })
                            }
                          >
                            {t("common.remove")}
                          </s-button>
                        )}
                      </s-button-group>
                    </s-stack>
                    {unavailable && <s-text color="subdued">{t("sorting.needsData.desc")}</s-text>}
                    {!unavailable && norm(shown(o)) !== norm(name(o)) && (
                      <s-text color="subdued">{t("sorting.sortsBy", { name: name(o) })}</s-text>
                    )}
                    {err(`options.${i}.label`) && (
                      <s-text tone="critical">{err(`options.${i}.label`)}</s-text>
                    )}
                  </s-stack>
                </s-box>
              </div>
            );
          })}
        </s-stack>
      </s-section>

      <s-section heading={t("sorting.addMetafield")}>
        <s-stack direction="block" gap="small-200">
          <s-paragraph color="subdued">{t("sorting.addMetafield.desc")}</s-paragraph>
          {sortableDefs.length === 0 ? (
            <s-paragraph color="subdued">{t("search.addMetafield.none")}</s-paragraph>
          ) : (
            <s-stack direction="inline" gap="small-200" alignItems="end">
              <s-select
                label={t("search.addMetafield")}
                placeholder={t("search.addMetafield.placeholder")}
                value={mf}
                onChange={(e) => setMf(value(e))}
              >
                {sortableDefs.map((d) => (
                  <s-option key={`${d.namespace}.${d.key}`} value={`${d.namespace}.${d.key}`}>
                    {`${d.name} (${d.namespace}.${d.key})`}
                  </s-option>
                ))}
              </s-select>
              <s-select
                label={t("sorting.direction")}
                value={dir}
                onChange={(e) => setDir(value(e) as "asc" | "desc")}
              >
                <s-option value="desc">{t("sorting.desc")}</s-option>
                <s-option value="asc">{t("sorting.asc")}</s-option>
              </s-select>
              <s-button
                disabled={!mf || f.options.some((o) => o.key === `mf:${mf}:${dir}`)}
                onClick={() => {
                  const def = sortableDefs.find((d) => `${d.namespace}.${d.key}` === mf);
                  const key = `mf:${mf}:${dir}` as SortKey;
                  setF({
                    ...f,
                    options: [
                      ...f.options,
                      {
                        key,
                        label: { en: def?.name ?? mf },
                        enabled: true,
                        position: f.options.length,
                      },
                    ],
                  });
                  setMf("");
                }}
              >
                {t("common.add")}
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading={t("sorting.defaults.heading")}>
        <s-stack direction="block" gap="base">
          <s-select
            label={t("sorting.defaults.search")}
            value={f.defaults.search ?? "relevance"}
            error={err("defaults.search")}
            onChange={(e) =>
              setF({ ...f, defaults: { ...f.defaults, search: value(e) as SortKey } })
            }
          >
            {enabled
              .filter((o) => !COLLECTION_ONLY_SORTS.has(o.key))
              .map((o) => (
                <s-option key={o.key} value={o.key}>
                  {name(o)}
                </s-option>
              ))}
          </s-select>
          <s-select
            label={t("sorting.defaults.collection")}
            value={f.defaults.collection ?? ""}
            error={err("defaults.collection")}
            onChange={(e) =>
              setF({
                ...f,
                defaults: {
                  ...f.defaults,
                  collection: (value(e) || undefined) as SortKey | undefined,
                },
              })
            }
          >
            <s-option value="">{t("sorting.defaults.collectionShopify")}</s-option>
            {enabled
              .filter((o) => !QUERY_ONLY_SORTS.has(o.key))
              .map((o) => (
                <s-option key={o.key} value={o.key}>
                  {name(o)}
                </s-option>
              ))}
          </s-select>
          <s-select
            label={t("sorting.tieBreak.heading")}
            value={f.tieBreak}
            onChange={(e) => setF({ ...f, tieBreak: value(e) as SortingForm["tieBreak"] })}
          >
            <s-option value="best_selling">{t("search.ranking.best_selling")}</s-option>
            <s-option value="created_desc">{t("search.ranking.created_desc")}</s-option>
          </s-select>
        </s-stack>
      </s-section>

      {p.bestSelling && (
        <s-section heading={t("sorting.bs.heading")}>
          <s-stack direction="block" gap="base">
            <s-paragraph color="subdued">
              {t(
                p.bestSelling.source === "orders"
                  ? "sorting.bs.orders.desc"
                  : "sorting.bs.storefront.desc",
              )}
            </s-paragraph>
            {p.bestSelling.source === "orders" ? (
              <>
                <s-text>
                  {p.bestSelling.computedAt
                    ? t("sorting.bs.status", {
                        date: new Date(p.bestSelling.computedAt).toLocaleString(
                          p.locale === "vi" ? "vi-VN" : "en-US",
                          { dateStyle: "medium", timeStyle: "short" },
                        ),
                        n: p.bestSelling.orders,
                      })
                    : t("sorting.bs.pending")}
                </s-text>
                <s-select
                  label={t("sorting.bs.metric")}
                  value={p.bestSelling.metric}
                  disabled={p.busy}
                  onChange={(e) =>
                    p.onBestSelling?.({
                      source: "orders",
                      metric: value(e) as BestSellingInfo["metric"],
                    })
                  }
                >
                  <s-option value="quantity">{t("sorting.bs.metric.quantity")}</s-option>
                  <s-option value="orders">{t("sorting.bs.metric.orders")}</s-option>
                  <s-option value="revenue">{t("sorting.bs.metric.revenue")}</s-option>
                </s-select>
                <s-button
                  variant="tertiary"
                  disabled={p.busy}
                  onClick={() =>
                    p.onBestSelling?.({ source: "storefront", metric: p.bestSelling!.metric })
                  }
                >
                  {t("sorting.bs.useShopify")}
                </s-button>
              </>
            ) : (
              <s-stack direction="block" gap="small-200">
                <s-paragraph color="subdued">{t("sorting.bs.privacy")}</s-paragraph>
                <s-button
                  disabled={p.busy}
                  onClick={() =>
                    p.onBestSelling?.({ source: "orders", metric: p.bestSelling!.metric })
                  }
                >
                  {t("sorting.bs.useOrders")}
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("sorting.overrides.heading")}>
        <s-button
          slot="secondary-actions"
          onClick={async () => {
            const picked = await p.onPickCollections();
            if (!picked.length) return;
            setTitles({ ...titles, ...Object.fromEntries(picked.map((c) => [c.id, c.title])) });
            const existing = new Set(f.overrides.map((o) => o.collectionId));
            setF({
              ...f,
              overrides: [
                ...f.overrides,
                ...picked
                  .filter((c) => !existing.has(c.id))
                  .map((c) => ({ collectionId: c.id, sortKey: "manual" as SortKey })),
              ],
            });
          }}
        >
          {t("sorting.overrides.add")}
        </s-button>
        <s-stack direction="block" gap="small-200">
          <s-paragraph color="subdued">{t("sorting.overrides.desc")}</s-paragraph>
          {f.overrides.length === 0 && <s-paragraph>{t("sorting.overrides.empty")}</s-paragraph>}
          {f.overrides.map((o, i) => (
            <s-stack
              key={o.collectionId}
              direction="inline"
              gap="small-200"
              alignItems="end"
              justifyContent="space-between"
            >
              <s-select
                label={titles[o.collectionId] ?? o.collectionId}
                value={o.sortKey}
                onChange={(e) =>
                  setF({
                    ...f,
                    overrides: f.overrides.map((x, k) =>
                      k === i ? { ...x, sortKey: value(e) as SortKey } : x,
                    ),
                  })
                }
              >
                {enabled
                  .filter((x) => !QUERY_ONLY_SORTS.has(x.key))
                  .map((x) => (
                    <s-option key={x.key} value={x.key}>
                      {name(x)}
                    </s-option>
                  ))}
              </s-select>
              <s-button
                tone="critical"
                variant="tertiary"
                onClick={() => setF({ ...f, overrides: f.overrides.filter((_, k) => k !== i) })}
              >
                {t("common.remove")}
              </s-button>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
      <s-modal ref={renameModal} id="sort-rename" heading={t("sorting.renameTitle")} size="base">
        {renaming && (
          <s-stack direction="block" gap="base">
            <s-text-field
              label={t("sorting.name")}
              details={translations.length ? t("filters.name.details") : undefined}
              placeholder={name(f.options[renaming.i])}
              value={renaming.label.en ?? ""}
              onChange={(e) =>
                setRenaming({ ...renaming, label: { ...renaming.label, en: value(e) } })
              }
            />
            {translations.length > 0 && (
              <s-stack direction="block" gap="small-200">
                <s-heading>{t("filters.translations")}</s-heading>
                <s-paragraph color="subdued">{t("filters.translations.desc")}</s-paragraph>
                {translations.map((l) => (
                  <s-text-field
                    key={l}
                    label={t("sorting.label", { locale: l })}
                    placeholder={renaming.label.en ?? ""}
                    value={renaming.label[l] ?? ""}
                    onChange={(e) =>
                      setRenaming({ ...renaming, label: { ...renaming.label, [l]: value(e) } })
                    }
                  />
                ))}
              </s-stack>
            )}
          </s-stack>
        )}
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => {
            if (renaming) {
              // Tên trống → về tên gốc của kiểu sắp xếp.
              const en = renaming.label.en?.trim() || name(f.options[renaming.i]);
              setOpt(renaming.i, { label: { ...renaming.label, en } });
            }
            renameModal.current?.hideOverlay();
          }}
        >
          {t("filters.done")}
        </s-button>
        <s-button slot="secondary-actions" onClick={() => renameModal.current?.hideOverlay()}>
          {t("common.cancel")}
        </s-button>
      </s-modal>
    </s-page>
  );
}
