// Bundle các process Node chạy ngoài admin (deploy tách — D9, task 6.4): search-api và worker, mỗi cái một file ESM.
// Dependency npm để ngoài bundle (cài bằng npm ci --omit=dev trong image); không cần tsx lúc chạy.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: ["services/search-api/src/server.ts"],
  outfile: "build/search-api/server.mjs",
});
await build({ ...common, entryPoints: ["workers/index.ts"], outfile: "build/worker/index.mjs" });
