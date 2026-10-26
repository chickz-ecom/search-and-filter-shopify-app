import { describe, expect, it } from "vitest";
import { allowedActionOrigins } from "./action-origins";

describe("allowedActionOrigins", () => {
  it("allows the app's own hostname, without the tunnel port", () => {
    expect(allowedActionOrigins("https://search.tiepdo.online:3460")).toEqual([
      "search.tiepdo.online",
    ]);
    expect(allowedActionOrigins("https://app.example.com")).toEqual(["app.example.com"]);
  });

  it("allows nothing extra when the app URL is missing or local", () => {
    expect(allowedActionOrigins(undefined)).toEqual([]);
    expect(allowedActionOrigins("")).toEqual([]);
    expect(allowedActionOrigins("not a url")).toEqual([]);
    expect(allowedActionOrigins("http://localhost:3000")).toEqual([]);
  });
});
