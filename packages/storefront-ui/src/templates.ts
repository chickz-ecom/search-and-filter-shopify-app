// Template mặc định (cú pháp template của SDK). Theme dev ghi đè bằng <template data-searchapp="product-card">…</template>.

// Mỗi template một hằng: bundle widget chỉ kéo template nó dùng (giới hạn 10 KB JS của app block — Theme Check).
export const PRODUCT_CARD =
  '<li class="sa-card"><a class="sa-card__link" href="{{url}}" data-sa-product="{{id}}" data-sa-pos="{{position}}">' +
  '<div class="sa-card__media">{{#if image}}<img src="{{image | img_url: 400}}" alt="{{image_alt}}" loading="lazy" width="400" height="400">{{/if}}' +
  '{{#each badge_labels}}<span class="sa-badge">{{this}}</span>{{/each}}</div>' +
  '<div class="sa-card__info">{{#if vendor}}<p class="sa-card__vendor">{{vendor}}</p>{{/if}}<h3 class="sa-card__title">{{title}}</h3>' +
  '<p class="sa-card__price">{{#if priceReady}}{{#if compare_at_price}}<s>{{compare_at_price}}</s> {{/if}}<span>{{price}}</span>' +
  '{{else}}<span class="sa-card__pending">{{view_price}}</span>{{/if}}</p></div></a></li>';
export const SUGGEST_ITEM =
  '<a role="option" id="{{option_id}}" class="sa-ac__item" href="{{url}}" data-sa-product="{{id}}" data-sa-pos="{{position}}">' +
  '{{#if image}}<img src="{{image | img_url: 96}}" alt="" width="48" height="48" loading="lazy">{{/if}}' +
  '<span class="sa-ac__text"><span class="sa-ac__title">{{title}}</span>{{#if priceReady}}<span class="sa-ac__price">{{price}}</span>{{/if}}</span></a>';
export const EMPTY =
  '<div class="sa-empty"><p class="sa-empty__title">{{title}}</p><p>{{hint}}</p></div>';

export const DEFAULT_TEMPLATES: Record<string, string> = {
  "product-card": PRODUCT_CARD,
  "suggest-item": SUGGEST_ITEM,
  empty: EMPTY,
};

/** Thứ tự: <template> trong theme (dev) → template ghi đè ở Appearance (merchant) → mặc định. */
export function templateFor(
  name: string,
  fallback: string,
  root: ParentNode = document,
  configured?: Record<string, string>,
): string {
  const el =
    root.querySelector<HTMLTemplateElement>(`template[data-searchapp="${name}"]`) ??
    document.querySelector<HTMLTemplateElement>(`template[data-searchapp="${name}"]`);
  return el ? el.innerHTML : configured?.[name] || fallback;
}

/** Áp token Appearance: chỉ biến --sa-* với giá trị an toàn (màu hex, px, số). */
export function applyCssVars(vars?: Record<string, string>) {
  if (!vars) return;
  const st = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) {
    if (/^--sa-[a-z-]+$/.test(k) && /^(#[0-9a-f]{3,8}|\d{1,3}(px)?)$/i.test(v))
      st.setProperty(k, v);
  }
}

/** Chỉ cho href tương đối hoặc http(s) — URL từ API không bao giờ thành javascript:/data: (task 6.3, test XSS). */
export const safeHref = (u: string) =>
  // eslint-disable-next-line no-control-regex -- cố ý: loại ký tự điều khiển khỏi URL (security 6.3)
  /^(https?:\/\/|\/(?![/\\])|\?|#)/i.test(u.trim()) && !/[\\\u0000-\u001f]/.test(u) ? u : "#";

export const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const fill = (t: string, vars: Record<string, string | number>) =>
  t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
