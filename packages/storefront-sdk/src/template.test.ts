// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { compile, escapeHtml, render } from "./template";

describe("template engine (no eval, escaped)", () => {
  it("interpolates dotted paths and escapes HTML", () => {
    expect(
      render("<h3>{{ title }}</h3><p>{{p.vendor}}</p>", {
        title: "<script>x</script>",
        p: { vendor: `A&"B'` },
      }),
    ).toBe("<h3>&lt;script&gt;x&lt;/script&gt;</h3><p>A&amp;&quot;B&#39;</p>");
  });

  it("supports if/else, unless and each with this/@index and parent scope", () => {
    const t =
      "{{#if on_sale}}SALE{{else}}-{{/if}}|{{#unless available}}OUT{{/unless}}|{{#each badges}}[{{@index}}:{{this}}:{{title}}]{{else}}none{{/each}}";
    expect(render(t, { on_sale: true, available: false, badges: ["a", "b"], title: "T" })).toBe(
      "SALE|OUT|[0:a:T][1:b:T]",
    );
    expect(render(t, { on_sale: false, available: true, badges: [] })).toBe("-||none");
  });

  it("applies filters", () => {
    const data = {
      image: "https://cdn.shopify.com/a.jpg?v=1",
      name: "Hello World",
      missing: "",
      q: "a b&c",
      n: 1999,
    };
    expect(render("{{ image | img_url: 400 }}", data)).toBe(
      "https://cdn.shopify.com/a.jpg?v=1&amp;width=400",
    );
    expect(render("{{ name | upcase }} {{ name | downcase }} {{ name | truncate: 5 }}", data)).toBe(
      "HELLO WORLD hello world Hello…",
    );
    expect(render('{{ missing | default: "n/a" }}', data)).toBe("n/a");
    expect(render("{{ q | url_encode }}", data)).toBe("a%20b%26c");
    expect(
      render("{{ n | money }}", data, { money: (v: number) => `$${(v / 100).toFixed(2)}` }),
    ).toBe("$19.99");
  });

  it("neutralises javascript: URLs and never evaluates code", () => {
    expect(render('<a href="{{url}}">x</a>', { url: " JavaScript:alert(1)" })).toBe(
      '<a href="#">x</a>',
    );
    expect(render("{{ constructor.constructor }}", {})).toBe("");
    expect(render("{{ __proto__ }}", {})).toBe("");
    expect(render("{{#each items}}{{this}}{{/each}}", { items: "notarray" })).toBe("");
  });

  it("tolerates broken templates (unclosed tags render literally rather than throwing)", () => {
    expect(() => render("{{#if x}}open", { x: true })).not.toThrow();
    expect(render("plain {{ }} text", {})).toBe("plain  text");
  });

  it("caches compiled templates", () => {
    expect(compile("{{a}}")).toBe(compile("{{a}}"));
    expect(escapeHtml(null)).toBe("");
  });
});
