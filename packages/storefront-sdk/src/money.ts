// Format tiền theo moneyFormat của theme (Liquid `{{ 0 | money }}` → vd. "${{amount}}", "{{amount_no_decimals_with_comma_separator}}₫").

const ZERO_DECIMAL = /^(JPY|KRW|VND|CLP|ISK|UGX|PYG|XAF|XOF|BIF|DJF|GNF|KMF|RWF|VUV|XPF)$/;

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL.test(currency.toUpperCase()) ? 0 : 2;
}

function group(n: number, decimals: number, thousands: string, decimal: string): string {
  const fixed = n.toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const intPart = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return frac ? intPart + decimal + frac : intPart;
}

/** `minor` = đơn vị nhỏ nhất của `currency`. */
export function formatMoney(minor: number, currency: string, format = "{{amount}}"): string {
  const value = minor / 10 ** currencyExponent(currency);
  return format.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    switch (key) {
      case "amount":
        return group(value, 2, ",", ".");
      case "amount_no_decimals":
        return group(value, 0, ",", ".");
      case "amount_with_comma_separator":
        return group(value, 2, ".", ",");
      case "amount_no_decimals_with_comma_separator":
        return group(value, 0, ".", ",");
      case "amount_with_apostrophe_separator":
        return group(value, 2, "'", ".");
      case "amount_no_decimals_with_space_separator":
        return group(value, 0, " ", ".");
      case "amount_with_space_separator":
        return group(value, 2, " ", ",");
      case "amount_with_period_and_space_separator":
        return group(value, 2, " ", ".");
      default:
        return group(value, 2, ",", ".");
    }
  });
}

/** Mẫu theo currency khi theme không cung cấp (fallback cho currency gốc). */
export function intlMoney(minor: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      minor / 10 ** currencyExponent(currency),
    );
  } catch {
    return `${(minor / 10 ** currencyExponent(currency)).toFixed(2)} ${currency}`;
  }
}
