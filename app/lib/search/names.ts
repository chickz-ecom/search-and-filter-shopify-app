// Tên tài nguyên engine theo shop (D6). shopId là cuid của bảng Shop (chỉ [a-z0-9]).

const SAFE = /^[a-z0-9]+$/;

function assertShopId(shopId: string) {
  if (!SAFE.test(shopId)) throw new Error(`Unsafe shopId for engine names: ${shopId}`);
}

export function productAlias(shopId: string): string {
  assertShopId(shopId);
  return `p_${shopId}`;
}

export function productCollection(shopId: string, version: number): string {
  assertShopId(shopId);
  return `p_${shopId}_v${version}`;
}

export function contentAlias(shopId: string): string {
  assertShopId(shopId);
  return `c_${shopId}`;
}

export function contentCollection(shopId: string, version: number): string {
  assertShopId(shopId);
  return `c_${shopId}_v${version}`;
}

export function synonymSetName(shopId: string): string {
  assertShopId(shopId);
  return `syn_${shopId}`;
}

export function curationSetName(shopId: string): string {
  assertShopId(shopId);
  return `cur_${shopId}`;
}

export function stopwordsId(shopId: string, locale = "en"): string {
  assertShopId(shopId);
  return `sw_${shopId}_${locale.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/** Mọi tài nguyên engine thuộc shop (xoá khi shop/redact). */
export function isShopResource(shopId: string, name: string): boolean {
  assertShopId(shopId);
  return [`p_${shopId}`, `c_${shopId}`, `syn_${shopId}`, `cur_${shopId}`, `sw_${shopId}`].some(
    (p) => name === p || name.startsWith(`${p}_`),
  );
}

/** Version kế tiếp từ tên collection hiện tại (`p_x_v3` → 4). */
export function nextVersion(current: string | null): number {
  const m = current ? /_v(\d+)$/.exec(current) : null;
  return m ? Number(m[1]) + 1 : 1;
}

/** Pattern collection cho scoped search key của shop (Typesense so khớp nguyên tên → không lẫn shop có id là tiền tố). */
export function scopedKeyCollections(shopId: string): string[] {
  assertShopId(shopId);
  return [`p_${shopId}`, `p_${shopId}_v.*`, `c_${shopId}`, `c_${shopId}_v.*`];
}
