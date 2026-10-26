export type ApiProduct = {
    gid: string;
    price_min: number;
    price_max: number;
    compare_at_max?: number;
    currency: string;
    [k: string]: unknown;
};
export type Localized = {
    /** gid → giá local (minor units của `currency`), null = không bán ở market này. */
    prices: Map<string, {
        min: number;
        max: number;
        compareAtMax?: number;
        available: boolean;
    } | null>;
    currency: string;
    /** Tỷ lệ theo ĐƠN VỊ CHÍNH: giáLocal / giáGốc (median của trang) — quy đổi khoảng giá filter. */
    rate: number;
    /** false khi không lấy được giá đúng (lỗi/timeout) → UI hiện "Xem giá". */
    ok: boolean;
};
export interface Pricer {
    /** `adjusted`: country của khách có điều chỉnh giá theo market (PublicConfig.adjustedCountries). */
    needsLocalPrice(adjusted?: boolean): boolean;
    localize(products: ApiProduct[]): Promise<Localized>;
    /** Tỷ lệ đã biết gần nhất (quy đổi khoảng giá trước khi gửi filter). */
    rate(): number;
}
