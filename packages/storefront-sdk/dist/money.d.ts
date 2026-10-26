export declare function currencyExponent(currency: string): number;
/** `minor` = đơn vị nhỏ nhất của `currency`. */
export declare function formatMoney(minor: number, currency: string, format?: string): string;
/** Mẫu theo currency khi theme không cung cấp (fallback cho currency gốc). */
export declare function intlMoney(minor: number, currency: string, locale?: string): string;
