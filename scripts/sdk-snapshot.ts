// Ghi snapshot hợp đồng SDK: `npm run sdk:snapshot` (sau khi đã thêm CHANGELOG cho thay đổi API).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractSurface } from "../packages/storefront-sdk/contract/surface";

const pkg = JSON.parse(readFileSync("packages/storefront-sdk/package.json", "utf8"));
const major = pkg.version.split(".")[0];
const file = `packages/storefront-sdk/contract/v${major}.json`;
mkdirSync("packages/storefront-sdk/contract", { recursive: true });
writeFileSync(
  file,
  JSON.stringify(
    { version: pkg.version, surface: extractSurface("packages/storefront-sdk/dist/types.d.ts") },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${file}`);
