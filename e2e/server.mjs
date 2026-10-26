// Static server cho E2E: phục vụ e2e/fixtures và bundle storefront đã build.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};
const mounts = [
  ["/assets/", join(root, "extensions/search-theme/assets")],
  ["/", join(root, "e2e/fixtures")],
];

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return res.end("ok");
  for (const [prefix, dir] of mounts) {
    if (!url.pathname.startsWith(prefix)) continue;
    let rel = normalize(url.pathname.slice(prefix.length)).replace(/^(\.\.[/\\])+/, "");
    if (!rel || rel === "." || rel.endsWith("/")) rel = join(rel, "index.html");
    try {
      const body = await readFile(join(dir, rel));
      res.writeHead(200, { "content-type": types[extname(rel)] ?? "application/octet-stream" });
      return res.end(body);
    } catch {
      /* thử mount kế tiếp */
    }
  }
  res.writeHead(404).end("not found");
}).listen(4173, "127.0.0.1");
