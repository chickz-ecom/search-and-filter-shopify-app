import { useEffect, useMemo, useRef, useState } from "react";
import { translator, type Locale, type MessageKey } from "../i18n";
import {
  DEFAULT_METAFIELD_FIELD,
  isMetafieldKey,
  type SearchField,
} from "../lib/config/search-fields";
import { defaultSearchSettings, type SearchSettingsConfig } from "../lib/config/search-settings";
import type { PreviewResult } from "../lib/search-service/preview.server";
import { SaveBar } from "./SaveBar";

// Trang Search (task 3.2, mục 8): bảng trường (bật/tắt, trọng số 1–10, typo, prefix), thêm metafield, cài đặt chung,
// "Thử tìm" theo cấu hình CHƯA lưu, khôi phục mặc định. Save Bar; lỗi đỏ inline tại field.

export type MetafieldDef = { namespace: string; key: string; name: string; type: string };

export type SearchViewProps = {
  locale: Locale;
  initial: SearchSettingsConfig;
  metafieldDefs: MetafieldDef[];
  currency: string;
  saving: boolean;
  errors: Record<string, string>;
  preview: PreviewResult | null;
  previewing: boolean;
  onSave: (settings: SearchSettingsConfig) => void;
  onPreview: (settings: SearchSettingsConfig, q: string) => void;
};

const TYPO = ["OFF", "LOW", "NORMAL"] as const;
const OOS = ["SHOW", "PUSH_DOWN", "HIDE"] as const;
const MODES = ["max_weight", "max_score", "sum_score"] as const;
const TYPES = ["products", "collections", "pages", "articles"] as const;

const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;
const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;

export function SearchView(p: SearchViewProps) {
  const t = translator(p.locale);
  const [s, setS] = useState<SearchSettingsConfig>(p.initial);
  const [q, setQ] = useState("");
  const [newMf, setNewMf] = useState("");
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(p.initial), [s, p.initial]);
  const addedMetafield =
    s.fields
      .filter((f) => isMetafieldKey(f.key))
      .map((f) => f.key)
      .join() !==
    p.initial.fields
      .filter((f) => isMetafieldKey(f.key))
      .map((f) => f.key)
      .join();

  // Sau khi lưu xong, initial mới về từ loader → đồng bộ state (điều chỉnh trong lúc render, không dùng effect).
  const [prevInitial, setPrevInitial] = useState(p.initial);
  if (prevInitial !== p.initial) {
    setPrevInitial(p.initial);
    setS(p.initial);
  }

  // Xem trước theo cấu hình đang sửa (debounce).
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!q.trim()) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => p.onPreview(s, q), 300);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, s]);

  const setField = (i: number, patch: Partial<SearchField>) =>
    setS((cur) => ({
      ...cur,
      fields: cur.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)),
    }));
  const label = (key: string) => {
    if (isMetafieldKey(key)) {
      const [ns, k] = key.slice(3).split(".");
      return p.metafieldDefs.find((d) => d.namespace === ns && d.key === k)?.name ?? key.slice(3);
    }
    return t(`field.${key}` as MessageKey);
  };
  const err = (path: string) => p.errors[path];
  const available = p.metafieldDefs.filter(
    (d) => !s.fields.some((f) => f.key === `mf:${d.namespace}.${d.key}`),
  );
  const money = new Intl.NumberFormat(p.locale === "vi" ? "vi-VN" : "en-US", {
    style: "currency",
    currency: p.currency,
  });

  return (
    <s-page heading={t("search.title")} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.home")}
      </s-link>
      <s-button
        slot="secondary-actions"
        onClick={() =>
          setS({
            ...defaultSearchSettings(),
            fields: [
              ...defaultSearchSettings().fields,
              ...s.fields
                .filter((f) => isMetafieldKey(f.key))
                .map((f) => ({ ...f, ...DEFAULT_METAFIELD_FIELD })),
            ],
          })
        }
      >
        {t("common.resetDefaults")}
      </s-button>
      <SaveBar
        id="search-save-bar"
        dirty={dirty}
        saving={p.saving}
        onSave={() => p.onSave(s)}
        onDiscard={() => setS(p.initial)}
        labels={{ save: t("common.save"), discard: t("common.discard") }}
      />

      {addedMetafield && (
        <s-banner slot="supplemental-start" tone="warning" heading={t("search.addMetafield")}>
          <s-paragraph>{t("search.metafield.warning")}</s-paragraph>
        </s-banner>
      )}
      {err("fields") && (
        <s-banner slot="supplemental-start" tone="critical" heading={t("common.errorSaving")}>
          <s-paragraph>{err("fields")}</s-paragraph>
        </s-banner>
      )}

      <s-section heading={t("search.fields.heading")} padding="none">
        <s-box paddingInline="base" paddingBlockStart="base">
          <s-paragraph color="subdued">{t("search.fields.desc")}</s-paragraph>
        </s-box>
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header listSlot="primary">{t("search.col.field")}</s-table-header>
            <s-table-header listSlot="inline">{t("search.col.enabled")}</s-table-header>
            <s-table-header listSlot="labeled">{t("search.col.weight")}</s-table-header>
            <s-table-header listSlot="labeled">{t("search.col.typo")}</s-table-header>
            <s-table-header listSlot="labeled">{t("search.col.prefix")}</s-table-header>
            <s-table-header listSlot="labeled">{""}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {s.fields.map((f, i) => (
              <s-table-row key={f.key}>
                <s-table-cell>
                  <s-text type="strong">{label(f.key)}</s-text>
                </s-table-cell>
                <s-table-cell>
                  <s-switch
                    label={`${t("search.col.enabled")}: ${label(f.key)}`}
                    labelAccessibilityVisibility="exclusive"
                    checked={f.enabled}
                    onChange={(e) => setField(i, { enabled: checked(e) })}
                  />
                </s-table-cell>
                <s-table-cell>
                  <s-number-field
                    label={`${t("search.col.weight")}: ${label(f.key)}`}
                    labelAccessibilityVisibility="exclusive"
                    value={String(f.weight)}
                    min={1}
                    max={10}
                    step={1}
                    inputMode="numeric"
                    error={err(`fields.${i}.weight`)}
                    onChange={(e) => setField(i, { weight: Math.round(Number(value(e)) || 1) })}
                  />
                </s-table-cell>
                <s-table-cell>
                  <s-checkbox
                    label={`${t("search.col.typo")}: ${label(f.key)}`}
                    labelAccessibilityVisibility="exclusive"
                    checked={f.typo}
                    onChange={(e) => setField(i, { typo: checked(e) })}
                  />
                </s-table-cell>
                <s-table-cell>
                  <s-checkbox
                    label={`${t("search.col.prefix")}: ${label(f.key)}`}
                    labelAccessibilityVisibility="exclusive"
                    checked={f.prefix}
                    onChange={(e) => setField(i, { prefix: checked(e) })}
                  />
                </s-table-cell>
                <s-table-cell>
                  {isMetafieldKey(f.key) && (
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() =>
                        setS((cur) => ({ ...cur, fields: cur.fields.filter((_, k) => k !== i) }))
                      }
                    >
                      {t("common.remove")}
                    </s-button>
                  )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <s-box padding="base">
          {p.metafieldDefs.length === 0 ? (
            <s-paragraph color="subdued">{t("search.addMetafield.none")}</s-paragraph>
          ) : (
            <s-stack direction="inline" gap="small-200" alignItems="end">
              <s-select
                label={t("search.addMetafield")}
                placeholder={t("search.addMetafield.placeholder")}
                value={newMf}
                onChange={(e) => setNewMf(value(e))}
              >
                {available.map((d) => (
                  <s-option key={`${d.namespace}.${d.key}`} value={`${d.namespace}.${d.key}`}>
                    {`${d.name} (${d.namespace}.${d.key})`}
                  </s-option>
                ))}
              </s-select>
              <s-button
                disabled={!newMf}
                onClick={() => {
                  setS((cur) => ({
                    ...cur,
                    fields: [
                      ...cur.fields,
                      {
                        key: `mf:${newMf}` as SearchField["key"],
                        ...DEFAULT_METAFIELD_FIELD,
                        enabled: true,
                      },
                    ],
                  }));
                  setNewMf("");
                }}
              >
                {t("common.add")}
              </s-button>
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading={t("search.ranking.heading")}>
        <s-stack direction="block" gap="base">
          <s-select
            label={t("search.ranking.mode")}
            value={s.matchMode}
            onChange={(e) =>
              setS({ ...s, matchMode: value(e) as SearchSettingsConfig["matchMode"] })
            }
          >
            {MODES.map((m) => (
              <s-option key={m} value={m}>
                {t(`search.ranking.${m}` as MessageKey)}
              </s-option>
            ))}
          </s-select>
          <s-select
            label={t("search.ranking.tieBreak")}
            value={s.relevanceTieBreak}
            onChange={(e) =>
              setS({
                ...s,
                relevanceTieBreak: value(e) as SearchSettingsConfig["relevanceTieBreak"],
              })
            }
          >
            <s-option value="best_selling">{t("search.ranking.best_selling")}</s-option>
            <s-option value="created_desc">{t("search.ranking.created_desc")}</s-option>
          </s-select>
          <s-checkbox
            label={t("search.ranking.exact")}
            checked={s.prioritizeExactMatch}
            onChange={(e) => setS({ ...s, prioritizeExactMatch: checked(e) })}
          />
        </s-stack>
      </s-section>

      <s-section heading={t("search.typo.heading")}>
        <s-stack direction="block" gap="base">
          <s-select
            label={t("search.typo.level")}
            value={s.typoTolerance}
            onChange={(e) =>
              setS({ ...s, typoTolerance: value(e) as SearchSettingsConfig["typoTolerance"] })
            }
          >
            {TYPO.map((x) => (
              <s-option key={x} value={x}>
                {t(`search.typo.${x}` as MessageKey)}
              </s-option>
            ))}
          </s-select>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field
              label={t("search.typo.min1")}
              value={String(s.minWordLengthFor1Typo)}
              min={1}
              max={20}
              inputMode="numeric"
              error={err("minWordLengthFor1Typo")}
              onChange={(e) => setS({ ...s, minWordLengthFor1Typo: Number(value(e)) || 1 })}
            />
            <s-number-field
              label={t("search.typo.min2")}
              value={String(s.minWordLengthFor2Typo)}
              min={1}
              max={30}
              inputMode="numeric"
              error={err("minWordLengthFor2Typo")}
              onChange={(e) => setS({ ...s, minWordLengthFor2Typo: Number(value(e)) || 1 })}
            />
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading={t("search.oos.heading")}>
        <s-choice-list
          label={t("search.oos.heading")}
          labelAccessibilityVisibility="exclusive"
          values={[s.showOutOfStock]}
          onChange={(e) =>
            setS({
              ...s,
              showOutOfStock: ((e.currentTarget as unknown as { values: string[] }).values[0] ??
                "SHOW") as SearchSettingsConfig["showOutOfStock"],
            })
          }
        >
          {OOS.map((x) => (
            <s-choice key={x} value={x} selected={s.showOutOfStock === x}>
              {t(`search.oos.${x}` as MessageKey)}
            </s-choice>
          ))}
        </s-choice-list>
      </s-section>

      <s-section heading={t("search.types.heading")}>
        <s-stack direction="block" gap="small-200">
          {TYPES.map((type) => (
            <s-stack key={type} direction="inline" gap="base" alignItems="center">
              <s-text type="strong">{t(`search.types.${type}` as MessageKey)}</s-text>
              <s-checkbox
                label={t("search.types.autocomplete")}
                checked={s.searchTypes[type].autocomplete}
                onChange={(e) =>
                  setS({
                    ...s,
                    searchTypes: {
                      ...s.searchTypes,
                      [type]: { ...s.searchTypes[type], autocomplete: checked(e) },
                    },
                  })
                }
              />
              <s-checkbox
                label={t("search.types.results")}
                checked={s.searchTypes[type].results}
                onChange={(e) =>
                  setS({
                    ...s,
                    searchTypes: {
                      ...s.searchTypes,
                      [type]: { ...s.searchTypes[type], results: checked(e) },
                    },
                  })
                }
              />
            </s-stack>
          ))}
          <s-text color="subdued">{t("search.types.scope")}</s-text>
        </s-stack>
      </s-section>

      <s-section heading={t("search.exclude.heading")}>
        <s-text-field
          label={t("search.exclude.label")}
          details={t("search.exclude.help")}
          value={s.excludeTags.join(", ")}
          error={err("excludeTags")}
          onChange={(e) =>
            setS({
              ...s,
              excludeTags: value(e)
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
      </s-section>

      <s-section slot="aside" heading={t("search.try.heading")}>
        <s-stack direction="block" gap="base">
          <s-text color="subdued">{t("search.try.desc")}</s-text>
          <s-search-field
            label={t("search.try.heading")}
            labelAccessibilityVisibility="exclusive"
            placeholder={t("search.try.placeholder")}
            value={q}
            onInput={(e) => setQ(value(e))}
          />
          {p.previewing && <s-spinner size="base" accessibilityLabel={t("search.try.heading")} />}
          {p.preview && q.trim() && (
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">{t("search.try.results", { n: p.preview.total })}</s-text>
              {p.preview.hits.length === 0 && <s-paragraph>{t("search.try.empty")}</s-paragraph>}
              {p.preview.hits.map((h) => (
                <s-box key={h.id} padding="small-200" borderWidth="base" borderRadius="base">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text type="strong">{`#${h.rank}`}</s-text>
                    {h.image && <s-thumbnail src={h.image} alt={h.title} size="small" />}
                    <s-stack direction="block" gap="small-500">
                      <s-text type="strong">{h.title}</s-text>
                      <s-text color="subdued">
                        {money.format(h.price_min / 100)}
                        {h.available ? "" : ` · ${t("search.try.soldOut")}`}
                      </s-text>
                      {h.matched.length > 0 && (
                        <s-stack direction="inline" gap="small-300">
                          <s-text color="subdued">{t("search.try.matched")}</s-text>
                          {h.matched.map((m) => (
                            <s-badge key={m.field}>{label(m.key)}</s-badge>
                          ))}
                        </s-stack>
                      )}
                    </s-stack>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
