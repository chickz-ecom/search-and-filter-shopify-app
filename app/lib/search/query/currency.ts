// Số chữ số thập phân của currency (minor units). JPY/KRW/VND = 0, USD/EUR = 2, KWD/BHD = 3.

const cache = new Map<string, number>();

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  let exp = cache.get(code);
  if (exp === undefined) {
    try {
      exp =
        new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
          .maximumFractionDigits ?? 2;
    } catch {
      exp = 2;
    }
    cache.set(code, exp);
  }
  return exp;
}

/** "19.99" USD → 1999; 199000 VND → 199000. */
export function toMinorUnits(amount: number | string, currency: string): number {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** currencyExponent(currency));
}

export function fromMinorUnits(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}
