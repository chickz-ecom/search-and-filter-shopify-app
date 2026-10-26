import { translator, type Locale, type MessageKey } from "../i18n";
import type { ThemeLinks } from "../lib/admin/theme-links";

// Trang Help (task 6.5, nav mục 8 "Settings → Help"): các bước cài đặt kèm deep link theme editor, câu hỏi thường gặp,
// liên hệ hỗ trợ. Không cần đăng nhập riêng; mọi thứ nằm trong admin.

export type HelpViewProps = {
  locale: Locale;
  links: ThemeLinks;
  supportEmail: string;
  docsUrl: string;
};

const FAQ = ["native", "sync", "prices", "theme", "uninstall"] as const;

export function HelpView(p: HelpViewProps) {
  const t = translator(p.locale);
  const steps: { key: string; href: string; external?: boolean }[] = [
    { key: "embed", href: p.links.embed, external: true },
    { key: "search", href: p.links.searchBlock, external: true },
    { key: "collection", href: p.links.collectionBlock, external: true },
    { key: "configure", href: "/app/search" },
  ];
  return (
    <s-page heading={t("help.title")} inlineSize="base">
      <s-section heading={t("help.setup.heading")}>
        <s-ordered-list>
          {steps.map((s) => (
            <s-list-item key={s.key}>
              <s-stack direction="block" gap="small-300">
                <s-text type="strong">{t(`help.setup.${s.key}` as MessageKey)}</s-text>
                <s-paragraph color="subdued">
                  {t(`help.setup.${s.key}.desc` as MessageKey)}
                </s-paragraph>
                <s-link href={s.href} target={s.external ? "_top" : undefined}>
                  {t(s.external ? "help.openThemeEditor" : "help.openSettings")}
                </s-link>
              </s-stack>
            </s-list-item>
          ))}
        </s-ordered-list>
      </s-section>

      <s-section heading={t("help.faq.heading")}>
        <s-stack direction="block" gap="base">
          {FAQ.map((k) => (
            <s-stack key={k} direction="block" gap="small-300">
              <s-heading>{t(`help.faq.${k}.q` as MessageKey)}</s-heading>
              <s-paragraph>{t(`help.faq.${k}.a` as MessageKey)}</s-paragraph>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={t("help.contact.heading")}>
        <s-stack direction="block" gap="small-200">
          <s-paragraph>{t("help.contact.desc")}</s-paragraph>
          <s-stack direction="inline" gap="small-200">
            <s-button href={`mailto:${p.supportEmail}`} target="_blank">
              {t("help.contact.email")}
            </s-button>
            {p.docsUrl && (
              <s-button variant="tertiary" href={p.docsUrl} target="_blank">
                {t("help.contact.docs")}
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
