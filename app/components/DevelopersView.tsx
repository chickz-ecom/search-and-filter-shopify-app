import { useMemo, useState } from "react";
import { translator, type Locale } from "../i18n";
import type { DevelopersInfo } from "../lib/admin/developers.server";
import { SaveBar } from "./SaveBar";

// Trang Developers (task 3.8): public key, endpoint, snippet mẫu (theme + headless), link docs, bật/tắt headless.
// Public key không phải bí mật (dùng trên storefront) nhưng headless vẫn phải bật tường minh.

export type DevelopersViewProps = {
  locale: Locale;
  info: DevelopersInfo;
  saving: boolean;
  errors: Record<string, string>;
  onSave: (form: { headlessEnabled: boolean; headlessOrigins: string[] }) => void;
  onCopy: (text: string) => void;
};

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

function snippets(info: DevelopersInfo) {
  const qs = `shop=${info.shopDomain}&key=${info.publicKey}`;
  return {
    theme: `<script>
  document.addEventListener("DOMContentLoaded", () =>
    window.SearchApp?.ready().then((sdk) => {
      sdk.on("results", (res) => console.log(res.total, "results"));
      sdk.search({ q: "shirt", sort: "price_asc" });
    }),
  );
</script>`,
    template: `<template data-searchapp="product-card">
  <li class="my-card">
    <a href="{{url}}"><img src="{{image | img_url: 400}}" alt="{{image_alt}}"></a>
    <h3>{{title}}</h3>
    <p>{{#if priceReady}}{{price}}{{/if}}</p>
  </li>
</template>`,
    headless: `curl "${info.endpoint}/v1/search?${qs}&q=shirt&limit=24"`,
  };
}

export function DevelopersView(p: DevelopersViewProps) {
  const t = translator(p.locale);
  const initial = useMemo(
    () => ({ enabled: p.info.headless.enabled, origins: p.info.headless.origins.join("\n") }),
    [p.info],
  );
  const [f, setF] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setF(initial);
  }
  const dirty =
    f.enabled !== initial.enabled ||
    lines(f.origins).join("\n") !== lines(initial.origins).join("\n");
  const h = p.info.headless;
  const code = snippets(p.info);
  const originError = Object.entries(p.errors).find(([k]) => k.startsWith("headlessOrigins"))?.[1];

  const copyField = (label: string, value: string) => (
    <s-stack direction="inline" gap="small-200" alignItems="end">
      <s-box inlineSize="100%" maxInlineSize="560px">
        <s-text-field label={label} value={value} readOnly />
      </s-box>
      <s-button onClick={() => p.onCopy(value)} accessibilityLabel={`${t("dev.copy")}: ${label}`}>
        {t("dev.copy")}
      </s-button>
    </s-stack>
  );
  const snippet = (heading: string, desc: string, text: string) => (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" justifyContent="space-between" alignItems="center">
        <s-heading>{heading}</s-heading>
        <s-button
          variant="tertiary"
          onClick={() => p.onCopy(text)}
          accessibilityLabel={`${t("dev.copy")}: ${heading}`}
        >
          {t("dev.copy")}
        </s-button>
      </s-stack>
      <s-paragraph color="subdued">{desc}</s-paragraph>
      <s-box padding="small-200" background="subdued" borderRadius="base" overflow="hidden">
        <pre style={{ margin: 0, overflowX: "auto", fontSize: 12, whiteSpace: "pre" }}>
          <code>{text}</code>
        </pre>
      </s-box>
    </s-stack>
  );

  return (
    <s-page heading={t("dev.title")} inlineSize="base">
      <SaveBar
        id="developers-save-bar"
        dirty={dirty}
        saving={p.saving}
        onSave={() => p.onSave({ headlessEnabled: f.enabled, headlessOrigins: lines(f.origins) })}
        onDiscard={() => setF(initial)}
        labels={{ save: t("common.save"), discard: t("common.discard") }}
      />
      {p.info.docsUrl && (
        <s-button slot="secondary-actions" href={p.info.docsUrl} target="_blank">
          {t("dev.docs")}
        </s-button>
      )}

      <s-section heading={t("dev.credentials.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">{t("dev.credentials.desc")}</s-paragraph>
          {copyField(t("dev.shop"), p.info.shopDomain)}
          {copyField(t("dev.publicKey"), p.info.publicKey)}
          {copyField(t("dev.endpoint"), p.info.endpoint)}
        </s-stack>
      </s-section>

      <s-section heading={t("dev.headless.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">{t("dev.headless.desc")}</s-paragraph>
          {!h.entitled && (
            <s-banner tone="info" heading={t("dev.headless.planTitle", { plan: h.minPlan })}>
              <s-paragraph>{t("dev.headless.planBody")}</s-paragraph>
              <s-button slot="secondary-actions" href="/app/plans">
                {t("dev.headless.viewPlans")}
              </s-button>
            </s-banner>
          )}
          <s-switch
            label={t("dev.headless.toggle")}
            details={t("dev.headless.toggleDetails")}
            checked={f.enabled}
            disabled={!h.entitled && !f.enabled}
            error={p.errors.headlessEnabled}
            onChange={(e) => setF({ ...f, enabled: e.currentTarget.checked })}
          />
          {f.enabled && (
            <s-text-area
              label={t("dev.headless.origins")}
              details={t("dev.headless.originsDetails")}
              rows={4}
              value={f.origins}
              placeholder="https://www.example.com"
              error={originError}
              onChange={(e) => setF({ ...f, origins: e.currentTarget.value })}
            />
          )}
        </s-stack>
      </s-section>

      <s-section heading={t("dev.snippets.heading")}>
        <s-stack direction="block" gap="large">
          {snippet(t("dev.snippets.theme"), t("dev.snippets.themeDesc"), code.theme)}
          {snippet(t("dev.snippets.template"), t("dev.snippets.templateDesc"), code.template)}
          {snippet(t("dev.snippets.headless"), t("dev.snippets.headlessDesc"), code.headless)}
        </s-stack>
      </s-section>
    </s-page>
  );
}
