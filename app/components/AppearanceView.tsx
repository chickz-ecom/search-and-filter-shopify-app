import { useMemo, useState } from "react";
import { translator, type Locale, type MessageKey } from "../i18n";
import {
  DEFAULT_TOKENS,
  TEXT_KEYS,
  type AppearanceConfig,
  type Tokens,
} from "../lib/config/appearance";
import { buildPreviewHtml } from "../lib/admin/appearance-preview";
import { SaveBar } from "./SaveBar";

// Trang Appearance (task 3.6, BFS 4.2.6): sửa token/text/template, preview trực tiếp đặt CẠNH phần chỉnh
// (iframe srcdoc dùng đúng CSS + template engine của widget). Lưu qua Contextual Save Bar.

export type AppearanceViewProps = {
  locale: Locale;
  locales: string[];
  currency: string;
  css: string;
  initial: AppearanceConfig;
  saving: boolean;
  errors: Record<string, string>;
  onSave: (cfg: AppearanceConfig) => void;
};

type TemplateName = "product-card" | "suggest-item" | "empty";
const COLORS = ["accent", "text", "muted", "border", "background", "sale"] as const;
const TEMPLATES: TemplateName[] = ["product-card", "suggest-item", "empty"];
const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;
const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
const num = (e: Event, fallback: number) => {
  const n = Number(value(e));
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

export function AppearanceView(p: AppearanceViewProps) {
  const t = translator(p.locale);
  const [cfg, setCfg] = useState<AppearanceConfig>(p.initial);
  const [prevInitial, setPrevInitial] = useState(p.initial);
  if (prevInitial !== p.initial) {
    setPrevInitial(p.initial);
    setCfg(p.initial);
  }
  const locales = [...new Set(["en", ...p.locales])].slice(0, 4);
  const [textLocale, setTextLocale] = useState(locales[0]);
  const [tpl, setTpl] = useState<TemplateName>("product-card");
  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(p.initial), [cfg, p.initial]);
  const preview = useMemo(
    () => buildPreviewHtml(cfg, p.css, textLocale, p.currency),
    [cfg, p.css, textLocale, p.currency],
  );
  const err = (path: string) => p.errors[path];
  const setTok = (patch: Partial<Tokens>) =>
    setCfg({ ...cfg, tokens: { ...cfg.tokens, ...patch } });
  const setText = (key: string, v: string) =>
    setCfg({
      ...cfg,
      texts: { ...cfg.texts, [textLocale]: { ...cfg.texts[textLocale], [key]: v } },
    });

  return (
    <s-page heading={t("appearance.title")} inlineSize="large">
      <SaveBar
        id="appearance-save-bar"
        dirty={dirty}
        saving={p.saving}
        onSave={() => p.onSave(cfg)}
        onDiscard={() => setCfg(p.initial)}
        labels={{ save: t("common.save"), discard: t("common.discard") }}
      />
      {Object.keys(p.errors).length > 0 && (
        <s-banner slot="supplemental-start" tone="critical" heading={t("common.errorSaving")}>
          <s-paragraph>{t("appearance.fixErrors")}</s-paragraph>
        </s-banner>
      )}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap="base">
        <s-stack direction="block" gap="base">
          <s-section heading={t("appearance.style.heading")}>
            <s-stack direction="block" gap="base">
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="small-200">
                {COLORS.map((c) => (
                  <s-color-field
                    key={c}
                    label={t(`appearance.color.${c}` as MessageKey)}
                    value={cfg.tokens[c]}
                    error={err(`tokens.${c}`)}
                    onChange={(e) => setTok({ [c]: value(e) })}
                  />
                ))}
              </s-grid>
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="small-200">
                <s-number-field
                  label={t("appearance.radius")}
                  suffix="px"
                  min={0}
                  max={24}
                  value={String(cfg.tokens.radius)}
                  error={err("tokens.radius")}
                  onChange={(e) => setTok({ radius: num(e, cfg.tokens.radius) })}
                />
                <s-number-field
                  label={t("appearance.gap")}
                  suffix="px"
                  min={4}
                  max={48}
                  value={String(cfg.tokens.gap)}
                  error={err("tokens.gap")}
                  onChange={(e) => setTok({ gap: num(e, cfg.tokens.gap) })}
                />
                <s-number-field
                  label={t("appearance.columns")}
                  min={2}
                  max={6}
                  value={String(cfg.tokens.columns)}
                  error={err("tokens.columns")}
                  onChange={(e) => setTok({ columns: num(e, cfg.tokens.columns) })}
                />
              </s-grid>
              <s-switch
                label={t("appearance.showVendor")}
                checked={cfg.tokens.showVendor}
                onChange={(e) => setTok({ showVendor: checked(e) })}
              />
              <s-button
                variant="tertiary"
                onClick={() => setCfg({ ...cfg, tokens: DEFAULT_TOKENS })}
              >
                {t("common.resetDefaults")}
              </s-button>
            </s-stack>
          </s-section>

          <s-section heading={t("appearance.texts.heading")}>
            <s-stack direction="block" gap="base">
              <s-paragraph color="subdued">{t("appearance.texts.desc")}</s-paragraph>
              {locales.length > 1 && (
                <s-select
                  label={t("appearance.texts.locale")}
                  value={textLocale}
                  onChange={(e) => setTextLocale(value(e))}
                >
                  {locales.map((l) => (
                    <s-option key={l} value={l}>
                      {l}
                    </s-option>
                  ))}
                </s-select>
              )}
              {TEXT_KEYS.map((k) => (
                <s-text-field
                  key={`${textLocale}.${k}`}
                  label={t(`appearance.text.${k}` as MessageKey)}
                  value={cfg.texts[textLocale]?.[k] ?? ""}
                  placeholder={t("appearance.texts.default")}
                  error={err(`texts.${textLocale}.${k}`)}
                  onChange={(e) => setText(k, value(e))}
                />
              ))}
            </s-stack>
          </s-section>

          <s-section heading={t("appearance.templates.heading")}>
            <s-stack direction="block" gap="base">
              <s-paragraph color="subdued">{t("appearance.templates.desc")}</s-paragraph>
              <s-select
                label={t("appearance.templates.which")}
                value={tpl}
                onChange={(e) => setTpl(value(e) as TemplateName)}
              >
                {TEMPLATES.map((n) => (
                  <s-option key={n} value={n}>
                    {t(`appearance.template.${n}` as MessageKey)}
                  </s-option>
                ))}
              </s-select>
              <s-text-area
                key={tpl}
                label={t("appearance.templates.code")}
                rows={8}
                value={cfg.templates[tpl] ?? ""}
                placeholder={t("appearance.templates.placeholder")}
                error={err(`templates.${tpl}`)}
                onChange={(e) =>
                  setCfg({ ...cfg, templates: { ...cfg.templates, [tpl]: value(e) } })
                }
              />
            </s-stack>
          </s-section>
        </s-stack>

        <s-section heading={t("appearance.preview.heading")}>
          <s-stack direction="block" gap="small-200">
            <s-paragraph color="subdued">{t("appearance.preview.desc")}</s-paragraph>
            <iframe
              title={t("appearance.preview.heading")}
              srcDoc={preview}
              sandbox=""
              style={{ inlineSize: "100%", blockSize: 640, border: 0 }}
            />
          </s-stack>
        </s-section>
      </s-grid>
    </s-page>
  );
}
