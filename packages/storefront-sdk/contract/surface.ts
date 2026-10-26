import { readFileSync } from "node:fs";
import ts from "typescript";

// Contract SDK v1 (task 4.3, D16): trích "bề mặt API" từ .d.ts công khai, so với snapshot đã commit và phân loại
// thay đổi. Phá vỡ (breaking) mà không nâng major → CI fail. JSDoc không thuộc hợp đồng (chỉ chữ ký).

export type Member = { type: string; optional: boolean };
export type TypeSurface =
  | { kind: "interface"; extends: string[]; members: Record<string, Member> }
  | { kind: "alias"; text: string };
export type Surface = Record<string, TypeSurface>;

/** Kiểu dev TRUYỀN VÀO SDK (thêm field bắt buộc = phá vỡ). Các kiểu còn lại là output (bớt field = phá vỡ). */
export const INPUT_TYPES = new Set([
  "SearchParams",
  "CollectionParams",
  "MountOptions",
  "UrlState",
  "Filters",
  "FilterValue",
  "Widget",
  "WidgetFactory",
]);

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/;\s*}/g, " }").replace(/;$/, "").trim();

export function extractSurface(file: string): Surface {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: Surface = {};
  for (const s of sf.statements) {
    if (ts.isInterfaceDeclaration(s)) {
      const members: Record<string, Member> = {};
      for (const m of s.members) {
        if (ts.isIndexSignatureDeclaration(m)) {
          members[`[${norm(m.parameters[0].getText(sf))}]`] = {
            type: norm(m.type.getText(sf)),
            optional: false,
          };
        } else if (ts.isMethodSignature(m)) {
          const sig = norm(m.getText(sf)).replace(/^[^(]+/, "");
          members[`${m.name.getText(sf)}()`] = { type: sig, optional: Boolean(m.questionToken) };
        } else if (ts.isPropertySignature(m)) {
          const ro = m.modifiers?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword)
            ? "readonly "
            : "";
          members[m.name.getText(sf)] = {
            type: ro + norm(m.type?.getText(sf) ?? "unknown"),
            optional: Boolean(m.questionToken),
          };
        }
      }
      out[s.name.text] = {
        kind: "interface",
        extends: (s.heritageClauses ?? []).flatMap((h) => h.types.map((t) => norm(t.getText(sf)))),
        members,
      };
    } else if (ts.isTypeAliasDeclaration(s)) {
      out[s.name.text] = { kind: "alias", text: norm(s.type.getText(sf)) };
    }
  }
  return out;
}

export type Diff = { breaking: string[]; additions: string[] };

export function diffSurface(before: Surface, after: Surface): Diff {
  const breaking: string[] = [];
  const additions: string[] = [];
  for (const [name, b] of Object.entries(before)) {
    const a = after[name];
    if (!a) {
      breaking.push(`${name}: removed`);
      continue;
    }
    if (a.kind !== b.kind) {
      breaking.push(`${name}: changed from ${b.kind} to ${a.kind}`);
      continue;
    }
    if (a.kind === "alias" && b.kind === "alias") {
      if (a.text === b.text) continue;
      // Union string mở rộng (thêm event/giá trị) là bổ sung; còn lại là thay đổi.
      const parts = (t: string) => new Set(t.split("|").map((x) => x.trim()));
      const pb = parts(b.text);
      const pa = parts(a.text);
      const widened = [...pb].every((x) => pa.has(x));
      if (
        widened &&
        !INPUT_TYPES.has(name) &&
        [...pa].every((x) => /^"[^"]*"$/.test(x) || pb.has(x))
      )
        additions.push(`${name}: ${a.text}`);
      else breaking.push(`${name}: ${b.text} → ${a.text}`);
      continue;
    }
    if (a.kind !== "interface" || b.kind !== "interface") continue;
    if (b.extends.join(",") !== a.extends.join(","))
      breaking.push(`${name}: extends ${b.extends} → ${a.extends}`);
    const input = INPUT_TYPES.has(name);
    for (const [m, bm] of Object.entries(b.members)) {
      const am = a.members[m];
      if (!am) breaking.push(`${name}.${m}: removed`);
      else if (am.type !== bm.type) breaking.push(`${name}.${m}: ${bm.type} → ${am.type}`);
      else if (input && bm.optional && !am.optional) breaking.push(`${name}.${m}: became required`);
      else if (!input && !bm.optional && am.optional)
        breaking.push(`${name}.${m}: may now be missing`);
      else if (am.optional !== bm.optional)
        additions.push(`${name}.${m}: optional ${bm.optional} → ${am.optional}`);
    }
    for (const [m, am] of Object.entries(a.members)) {
      if (b.members[m]) continue;
      if (input && !am.optional) breaking.push(`${name}.${m}: new required input`);
      else additions.push(`${name}.${m}`);
    }
  }
  for (const name of Object.keys(after)) if (!before[name]) additions.push(`${name}: new type`);
  return { breaking, additions };
}
