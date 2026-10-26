// Template engine tối giản cho template ghi đè của theme dev (mục 6.4c): {{var}}, {{var | filter: arg}},
// {{#if}}/{{else}}/{{/if}}, {{#unless}}, {{#each}} (this, @index). KHÔNG eval/new Function; mọi output được escape.

type Node =
  | { t: "text"; v: string }
  | { t: "var"; path: string; filters: [string, string | undefined][] }
  | { t: "if"; path: string; neg: boolean; yes: Node[]; no: Node[] }
  | { t: "each"; path: string; body: Node[]; empty: Node[] };

export type Helpers = { money?: (v: number) => string };

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (v: unknown) =>
  v == null ? "" : String(v).replace(/[&<>"']/g, (c) => ESC[c]);

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function parse(src: string): Node[] {
  const root: Node[] = [];
  const stack: { node: Node | null; target: Node[] }[] = [{ node: null, target: root }];
  const re = /\{\{\s*([#/]?)([^}]*?)\s*\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (n: Node) => stack[stack.length - 1].target.push(n);
  while ((m = re.exec(src))) {
    if (m.index > last) push({ t: "text", v: src.slice(last, m.index) });
    last = re.lastIndex;
    const [, sigil, body] = m;
    const [head, ...rest] = body.trim().split(/\s+/);
    const arg = rest.join(" ");
    if (sigil === "#") {
      const n: Node =
        head === "each"
          ? { t: "each", path: arg, body: [], empty: [] }
          : { t: "if", path: arg, neg: head === "unless", yes: [], no: [] };
      push(n);
      stack.push({ node: n, target: n.t === "each" ? n.body : n.yes });
    } else if (sigil === "/") {
      if (stack.length > 1) stack.pop();
    } else if (head === "else" && stack.length > 1) {
      const top = stack[stack.length - 1].node!;
      stack[stack.length - 1].target = top.t === "each" ? top.empty : (top as { no: Node[] }).no;
    } else if (body.trim()) {
      const [path, ...filters] = body.split("|").map((s) => s.trim());
      push({
        t: "var",
        path,
        filters: filters.map((f) => {
          const i = f.indexOf(":");
          return i < 0
            ? [f, undefined]
            : [
                f.slice(0, i).trim(),
                f
                  .slice(i + 1)
                  .trim()
                  .replace(/^["']|["']$/g, ""),
              ];
        }),
      });
    }
  }
  if (last < src.length) push({ t: "text", v: src.slice(last) });
  return root;
}

type Scope = { data: unknown; index?: number; parent?: Scope };

function lookup(scope: Scope | undefined, path: string): unknown {
  if (path === "this" || path === ".") return scope?.data;
  if (path === "@index") return scope?.index;
  const parts = path.split(".");
  if (parts.some((p) => FORBIDDEN.has(p))) return undefined;
  for (let s = scope; s; s = s.parent) {
    let v: unknown = s.data;
    if (v == null || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, parts[0]))
      continue;
    for (const p of parts) {
      if (v == null || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, p))
        return undefined;
      v = (v as Record<string, unknown>)[p];
    }
    return v;
  }
  return undefined;
}

function applyFilter(v: unknown, name: string, arg: string | undefined, h: Helpers): unknown {
  switch (name) {
    case "img_url": {
      if (!v) return v;
      const s = String(v);
      return arg ? `${s}${s.includes("?") ? "&" : "?"}width=${parseInt(arg, 10) || 400}` : s;
    }
    case "money":
      return h.money && typeof v === "number" ? h.money(v) : v;
    case "upcase":
      return v == null ? v : String(v).toUpperCase();
    case "downcase":
      return v == null ? v : String(v).toLowerCase();
    case "truncate": {
      const n = parseInt(arg ?? "50", 10);
      const s = v == null ? "" : String(v);
      return s.length > n ? s.slice(0, n) + "…" : s;
    }
    case "default":
      return v == null || v === "" || v === false ? arg : v;
    case "url_encode":
      return v == null ? v : encodeURIComponent(String(v));
    case "size":
      return Array.isArray(v) ? v.length : v == null ? 0 : String(v).length;
    default:
      return v;
  }
}

const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

function run(nodes: Node[], scope: Scope, h: Helpers): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "var") {
      let v = lookup(scope, n.path);
      for (const [f, a] of n.filters) v = applyFilter(v, f, a, h);
      if (typeof v === "function" || (v !== null && typeof v === "object")) v = "";
      const s = escapeHtml(v);
      out += /^\s*javascript:/i.test(s) ? "#" : s;
    } else if (n.t === "if") {
      out += truthy(lookup(scope, n.path)) !== n.neg ? run(n.yes, scope, h) : run(n.no, scope, h);
    } else {
      const list = lookup(scope, n.path);
      if (Array.isArray(list) && list.length)
        list.forEach((item, i) => (out += run(n.body, { data: item, index: i, parent: scope }, h)));
      else out += run(n.empty, scope, h);
    }
  }
  return out;
}

const cache = new Map<string, Node[]>();

export function compile(src: string): Node[] {
  let ast = cache.get(src);
  if (!ast) {
    ast = parse(src);
    if (cache.size > 100) cache.clear();
    cache.set(src, ast);
  }
  return ast;
}

export function render(src: string, data: unknown, helpers: Helpers = {}): string {
  return run(compile(src), { data }, helpers);
}
