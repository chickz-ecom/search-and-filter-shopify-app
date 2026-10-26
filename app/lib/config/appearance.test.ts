import { describe, expect, it } from "vitest";
import {
  AppearanceSchema,
  DEFAULT_TOKENS,
  normalizeTokens,
  SafeTemplate,
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
    ]) {
      expect(SafeTemplate.safeParse(bad).success).toBe(false);
    }
  });

  it("fills missing tokens with defaults", () => {
    expect(normalizeTokens({ accent: "#ff0000", radius: 99 })).toEqual({
      ...DEFAULT_TOKENS,
      accent: "#ff0000",
    });
  });
});
