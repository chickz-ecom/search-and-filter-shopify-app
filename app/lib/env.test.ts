import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.server";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://127.0.0.1:6379/5",
  TYPESENSE_API_KEY: "k",
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.TYPESENSE_HOST).toBe("localhost");
    expect(env.TYPESENSE_PORT).toBe(8108);
    expect(env.REDIS_PREFIX).toBe("sa");
    expect(env.SEARCH_DEFAULT_LOCALE).toBe("en");
  });

  it("rejects missing secrets with a readable message", () => {
    expect(() => parseEnv({ ...base, TYPESENSE_API_KEY: "" })).toThrow(/TYPESENSE_API_KEY/);
  });

  it("coerces numeric ports", () => {
    expect(parseEnv({ ...base, TYPESENSE_PORT: "443", SEARCH_API_PORT: "9000" })).toMatchObject({
      TYPESENSE_PORT: 443,
      SEARCH_API_PORT: 9000,
    });
  });
});
