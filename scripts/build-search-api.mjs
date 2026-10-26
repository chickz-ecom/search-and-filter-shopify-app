// Bundle services/search-api thành một file chạy bằng node (deploy tách khỏi admin — D9).
// Dependency npm để ngoài bundle (cài bằng npm ci --omit=dev trong image).
import { build } from "esbuild";

await build({
  entryPoints: ["services/search-api/src/server.ts"],
  outfile: "build/search-api/server.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
