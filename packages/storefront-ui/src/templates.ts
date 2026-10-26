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

export function templateFor(name: string, root: ParentNode = document): string {
  const el =
    root.querySelector<HTMLTemplateElement>(`template[data-searchapp="${name}"]`) ??
    document.querySelector<HTMLTemplateElement>(`template[data-searchapp="${name}"]`);
  return el ? el.innerHTML : (DEFAULT_TEMPLATES[name] ?? "");
}

export const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const fill = (t: string, vars: Record<string, string | number>) =>
  t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
