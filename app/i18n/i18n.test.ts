import { describe, expect, it } from "vitest";
import { en } from "./en";
import { localeFromRequest, translate } from "./index";
import { vi } from "./vi";

describe("i18n", () => {
  it("vi has every en key and no extras", () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
  });

  it("interpolates variables", () => {
    expect(translate("vi", "sync.indexed", { indexed: 5, total: 10 })).toBe(
      "Đã index 5/10 sản phẩm",
    );
  });

  it("resolves the admin locale from the URL then Accept-Language", () => {
    expect(localeFromRequest(new Request("https://a/app?locale=vi-VN"))).toBe("vi");
    expect(
      localeFromRequest(
        new Request("https://a/app", { headers: { "accept-language": "vi,en;q=0.8" } }),
      ),
    ).toBe("vi");
    expect(localeFromRequest(new Request("https://a/app?locale=fr"))).toBe("en");
  });
});
