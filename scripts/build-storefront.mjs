// Bundle packages/* (SDK + widget) vào extensions/search-theme/assets và kiểm tra ngân sách gzip.
// Vượt ngân sách → exit 1 (CI fail). Ngân sách: docs/02-PLAN.md mục 7.1, 7.4, task 2.6, 2.9.
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outdir = join(root, "extensions/search-theme/assets");

export const BUNDLES = [
  { entry: "packages/storefront-sdk/src/index.ts", out: "searchapp-sdk.js", budget: 8 * 1024 },
  {
    entry: "packages/storefront-ui/src/instant.ts",
    out: "searchapp-instant.js",
    budget: 10 * 1024,
  },
  {
    entry: "packages/storefront-ui/src/results.ts",
    out: "searchapp-results.js",
    budget: 10 * 1024,
    // Khai trong "javascript" của app block → Theme Check AssetSizeAppBlockJavaScript: ≤ 10 000 B (chưa nén).
    rawBudget: 10_000,
  },
];
// Tổng JS tải lần đầu (SDK + instant, results chỉ tải ở trang có block) ≤ 20 KB gzip.
const FIRST_LOAD = ["searchapp-sdk.js", "searchapp-instant.js"];
const FIRST_LOAD_BUDGET = 20 * 1024;

mkdirSync(outdir, { recursive: true });
const sizes = {};
let failed = false;
for (const b of BUNDLES) {
  const entry = join(root, b.entry);
  if (!existsSync(entry)) {
    console.log(`skip ${b.out} (missing ${b.entry})`);
    continue;
  }
  const outfile = join(outdir, b.out);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2020"],
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const raw = readFileSync(outfile);
  const gz = gzipSync(raw, { level: 9 }).length;
  sizes[b.out] = gz;
  const ok = gz <= b.budget && (!b.rawBudget || raw.length <= b.rawBudget);
  if (!ok) failed = true;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${b.out}: ${(gz / 1024).toFixed(2)} KB gzip (budget ${b.budget / 1024} KB)` +
      (b.rawBudget ? `, ${raw.length} B raw (budget ${b.rawBudget} B)` : ""),
  );
}
const first = FIRST_LOAD.reduce((s, f) => s + (sizes[f] ?? 0), 0);
console.log(
  `first-load JS: ${(first / 1024).toFixed(2)} KB gzip (budget ${FIRST_LOAD_BUDGET / 1024} KB)`,
);
if (first > FIRST_LOAD_BUDGET) failed = true;
if (failed) process.exit(1);
