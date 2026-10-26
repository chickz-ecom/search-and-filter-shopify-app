// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeTemplate } from "./sanitize";

describe("sanitizeTemplate (6.3, defense in depth)", () => {
  it("leaves safe templates byte-for-byte unchanged (placeholders inside tags survive)", () => {
    const tpl = '<li class="c {{#if on_sale}}sale{{/if}}"><a href="{{url}}">{{title}}</a></li>';
    expect(sanitizeTemplate(tpl)).toBe(tpl);
  });

  it("strips handlers, script-like tags and script URLs", () => {
    const out = sanitizeTemplate(
      '<li><img/onerror=alert(1) src=x><svg onload=alert(2)></svg><a href="jav&#x61;script:alert(3)">x</a>' +
        '<script>alert(4)</script><a href=" java\tscript:alert(5)">y</a></li>',
    );
    expect(out).not.toMatch(/onerror|onload|<svg|<script|javascript/i);
    expect(out).toContain("<img");
    expect(out).toContain(">x</a>");
  });
});
