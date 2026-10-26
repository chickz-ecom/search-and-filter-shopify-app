import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

// Contract test cho shopify.app.toml (task 0.4). `shopify app config validate` cần đăng nhập → HUMAN_TODO B1.
const toml = parse(readFileSync("shopify.app.toml", "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("shopify.app.toml", () => {
  it("pins API version 2026-10 everywhere (D14)", () => {
    expect(toml.webhooks.api_version).toBe("2026-10");
    expect(toml.events.api_version).toBe("2026-10");
  });

  it("declares the planned scopes", () => {
    const scopes = String(toml.access_scopes.scopes).split(",");
    expect(scopes).toEqual(
      expect.arrayContaining([
        "read_products",
        "read_inventory",
        "read_product_listings",
        "read_publications",
        "read_translations",
        "read_locales",
        "read_markets",
        "unauthenticated_read_product_listings",
        "write_app_proxy",
        "write_pixels",
        "read_customer_events",
      ]),
    );
    expect(scopes).not.toContain("read_orders"); // D13: không cần Protected Customer Data
  });

  it("declares all three compliance topics via compliance_topics", () => {
    const compliance = toml.webhooks.subscriptions.flatMap(
      (s: { compliance_topics?: string[] }) => s.compliance_topics ?? [],
    );
    expect(compliance.sort()).toEqual([
      "customers/data_request",
      "customers/redact",
      "shop/redact",
    ]);
  });

  it("subscribes to the sync topics", () => {
    const topics = toml.webhooks.subscriptions.flatMap(
      (s: { topics?: string[] }) => s.topics ?? [],
    );
    for (const t of [
      "products/create",
      "products/update",
      "products/delete",
      "collections/update",
      "inventory_levels/update",
      "bulk_operations/finish",
      "app/uninstalled",
      "markets/update",
    ]) {
      expect(topics).toContain(t);
    }
  });

  it("subscribes to collection events (D8) with singular [[events.subscription]]", () => {
    const triggers = toml.events.subscription.flatMap((s: { triggers: string[] }) => s.triggers);
    expect(triggers).toEqual(
      expect.arrayContaining(["collection.products", "collection.sortOrder"]),
    );
  });

  it("never routes webhooks under /app (layout app.tsx)", () => {
    for (const s of toml.webhooks.subscriptions) expect(s.uri.startsWith("/app")).toBe(false);
  });
});
