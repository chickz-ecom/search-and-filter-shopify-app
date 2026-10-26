// Template mặc định (cú pháp template của SDK). Theme dev ghi đè bằng <template data-searchapp="product-card">…</template>.

export const DEFAULT_TEMPLATES: Record<string, string> = {
  "product-card":
    '<li class="sa-card"><a class="sa-card__link" href="{{url}}" data-sa-product="{{id}}" data-sa-pos="{{position}}">' +
    '<div class="sa-card__media">{{#if image}}<img src="{{image | img_url: 400}}" alt="{{image_alt}}" loading="lazy" width="400" height="400">{{/if}}' +
    '{{#each badge_labels}}<span class="sa-badge">{{this}}</span>{{/each}}</div>' +
    '<div class="sa-card__info">{{#if vendor}}<p class="sa-card__vendor">{{vendor}}</p>{{/if}}<h3 class="sa-card__title">{{title}}</h3>' +
    '<p class="sa-card__price">{{#if priceReady}}{{#if compare_at_price}}<s>{{compare_at_price}}</s> {{/if}}<span>{{price}}</span>' +
    '{{else}}<span class="sa-card__pending">{{view_price}}</span>{{/if}}</p></div></a></li>',
  "suggest-item":
    '<a role="option" id="{{option_id}}" class="sa-ac__item" href="{{url}}" data-sa-product="{{id}}" data-sa-pos="{{position}}">' +
    '{{#if image}}<img src="{{image | img_url: 96}}" alt="" width="48" height="48" loading="lazy">{{/if}}' +
    '<span class="sa-ac__text"><span class="sa-ac__title">{{title}}</span>{{#if priceReady}}<span class="sa-ac__price">{{price}}</span>{{/if}}</span></a>',
  empty: '<div class="sa-empty"><p class="sa-empty__title">{{title}}</p><p>{{hint}}</p></div>',
};

/** Thứ tự: <template> trong theme (dev) → template ghi đè ở Appearance (merchant) → mặc định. */
export function templateFor(
  name: string,
  root: ParentNode = document,
  configured?: Record<string, string>,
): string {
  const el =
    root.querySelector<HTMLTemplateElement>(`template[data-searchapp="${name}"]`) ??
    document.querySelector<HTMLTemplateElement>(`template[data-searchapp="${name}"]`);
  return el ? el.innerHTML : configured?.[name] || (DEFAULT_TEMPLATES[name] ?? "");
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

export const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const fill = (t: string, vars: Record<string, string | number>) =>
  t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
