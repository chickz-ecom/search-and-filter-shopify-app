// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { safeHref } from "./templates";

describe("safeHref (6.3)", () => {
  it("keeps relative and http(s) links, neutralises script and data URLs", () => {
    for (const ok of [
      "/collections/summer",
      "?q=x",
      "#top",
      "https://shop.example/p",
      "HTTP://a.b",
    ])
      expect(safeHref(ok)).toBe(ok);
    for (const bad of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,<script>",
      "//evil.example",
      "/\\evil.example", // trình duyệt hiểu "\" như "/" → "//evil.example"
      "/a\u0000b",
      "vbscript:x",
    ])
      expect(safeHref(bad)).toBe("#");
  });
});
