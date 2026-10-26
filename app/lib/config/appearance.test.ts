import { PRODUCT_CARD as DEFAULT_PRODUCT_CARD } from "../../../packages/storefront-ui/src/templates";
import { describe, expect, it } from "vitest";
import {
  AppearanceSchema,
  DEFAULT_TOKENS,
  normalizeTokens,
  SafeTemplate,
  templateProblem,
  tokensToCssVars,
} from "./appearance";

describe("appearance config (3.6)", () => {
  it("accepts defaults and maps tokens to CSS variables", () => {
    expect(
      AppearanceSchema.safeParse({ tokens: DEFAULT_TOKENS, texts: {}, templates: {} }).success,
    ).toBe(true);
    expect(tokensToCssVars(DEFAULT_TOKENS)).toMatchObject({
      "--sa-accent": "#1a1a1a",
      "--sa-radius": "8px",
      "--sa-cols": "4",
    });
  });

  it("rejects CSS injection in tokens", () => {
    const r = AppearanceSchema.safeParse({
      tokens: { ...DEFAULT_TOKENS, accent: "red;}body{display:none" },
      texts: {},
      templates: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects scripts, handlers and javascript: links in templates", () => {
    expect(SafeTemplate.safeParse("<li>{{title}}</li>").success).toBe(true);
    for (const bad of [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">',
      "<iframe src=x>",
      // Bỏ lọt regex cũ (security check 6.3): không khoảng trắng trước handler, encode entity, thẻ svg/math.
      "<img/onerror=alert(1) src=x>",
      "<svg/onload=alert(1)>",
      '<a href="jav&#x61;script:alert(1)">x</a>',
      '<a href="java\tscript:alert(1)">x</a>',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      '<div style="background:url(javascript:alert(1))">',
      "<math><mi xlink:href=javascript:alert(1)>",
      "<!DOCTYPE html><p>",
      '<li {{#if x}}onclick="alert(1)"{{/if}}>',
    ]) {
      expect(SafeTemplate.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("accepts real-world templates with placeholders, conditionals in tags and data attributes", () => {
    for (const ok of [
      DEFAULT_PRODUCT_CARD,
      '<li class="card {{#if on_sale}}card--sale{{/if}}"><a href="{{url}}" data-sa-product="{{id}}" aria-label="{{title}}">' +
        '<img src="{{image | img_url: 400}}" alt="{{image_alt}}" loading="lazy" width="400" height="400" style="aspect-ratio:1">' +
        "<h3>{{title}}</h3>{{#each badge_labels}}<span>{{this}}</span>{{/each}}</a></li>",
      '<a href="/collections/sale" target="_blank" rel="noopener">Sale</a>',
    ])
      expect(templateProblem(ok), ok).toBeNull();
    expect(templateProblem("<img/onerror=alert(1) src=x>")).toBe(
      'The "onerror" attribute isn\'t allowed in templates',
    );
  });

  it("fills missing tokens with defaults", () => {
    expect(normalizeTokens({ accent: "#ff0000", radius: 99 })).toEqual({
      ...DEFAULT_TOKENS,
      accent: "#ff0000",
    });
  });
});
