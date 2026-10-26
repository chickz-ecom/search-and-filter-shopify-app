import { useState, type ReactNode } from "react";
import { translator, type Locale, type MessageKey } from "../../i18n";
import { PRESETS, presetRange, type DateRange } from "../../lib/analytics/range";
import { formatters } from "./format";

// Khung trang Analytics (7.3): điều hướng Overview / Search / Collections / Export + chọn khoảng ngày
// (preset hoặc s-date-picker type="range"). Khoảng ngày nằm trên URL nên đổi trang vẫn giữ.

export type AnalyticsSection = "overview" | "search" | "collections" | "export";
const SECTIONS: AnalyticsSection[] = ["overview", "search", "collections", "export"];

export type AnalyticsShellProps = {
  locale: Locale;
  currency: string;
  range: DateRange;
  active: AnalyticsSection;
  onNavigate: (section: AnalyticsSection) => void;
  onRange: (range: DateRange) => void;
  children: ReactNode;
};

const POPOVER = "sa-analytics-range";

export function AnalyticsShell(p: AnalyticsShellProps) {
  const t = translator(p.locale);
  const f = formatters(p.locale, p.currency);
  const label =
    p.range.from === p.range.to
      ? f.date(p.range.from)
      : `${f.date(p.range.from)} – ${f.date(p.range.to)}`;

  return (
    <s-page heading={t("analytics.title")} inlineSize="large">
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
        <s-button-group>
          {SECTIONS.map((s) => (
            <s-button
              key={s}
              slot={s === p.active ? "primary-action" : "secondary-actions"}
              variant={s === p.active ? "primary" : "secondary"}
              onClick={() => p.onNavigate(s)}
            >
              {t(`analytics.nav.${s}` as MessageKey)}
            </s-button>
          ))}
        </s-button-group>
        <s-button icon="calendar" commandFor={POPOVER} accessibilityLabel={t("analytics.range")}>
          {label}
        </s-button>
      </s-stack>
      {/* key: khoảng ngày đổi (preset, Back) → lịch chọn lấy lại giá trị mới. */}
      <RangePopover
        key={`${p.range.from}--${p.range.to}`}
        locale={p.locale}
        range={p.range}
        onRange={p.onRange}
      />
      {p.children}
    </s-page>
  );
}

function RangePopover(p: { locale: Locale; range: DateRange; onRange: (r: DateRange) => void }) {
  const t = translator(p.locale);
  const [picked, setPicked] = useState(`${p.range.from}--${p.range.to}`);
  const apply = (r: DateRange) => {
    (
      document.getElementById(POPOVER) as (HTMLElement & { hidePopover?: () => void }) | null
    )?.hidePopover?.();
    p.onRange(r);
  };
  return (
    <s-popover id={POPOVER}>
      <s-box padding="base">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200">
            {PRESETS.map((preset) => (
              <s-button key={preset} variant="tertiary" onClick={() => apply(presetRange(preset))}>
                {t(`analytics.range.preset.${preset}` as MessageKey)}
              </s-button>
            ))}
          </s-stack>
          <s-date-picker
            type="range"
            value={picked}
            view={p.range.to.slice(0, 7)}
            disallow="future"
            onChange={(e) => setPicked(e.currentTarget.value)}
          />
          <s-button
            variant="primary"
            onClick={() => {
              const [from, to] = picked.split("--");
              if (from && to) apply({ from, to });
            }}
          >
            {t("analytics.range.apply")}
          </s-button>
        </s-stack>
      </s-box>
    </s-popover>
  );
}
