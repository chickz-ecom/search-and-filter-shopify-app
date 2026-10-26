import { Link } from "react-router";

// Back-office (8.3): helper giao diện dùng chung.

/** "2026-10-26 18:07 UTC" — định dạng cố định để server và client render giống nhau. */
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? `${new Date(d).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";

export const fmtNum = (n: number) => n.toLocaleString("en-US");
export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Phân trang bằng link (giữ các tham số khác của URL). */
export function Pager(p: { page: number; pages: number; search: string }) {
  if (p.pages <= 1) return null;
  const href = (n: number) => {
    const q = new URLSearchParams(p.search);
    q.set("page", String(n));
    return `?${q}`;
  };
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      {p.page > 1 ? <Link to={href(p.page - 1)}>← Previous</Link> : <span />}
      <s-text color="subdued">
        Page {p.page} of {p.pages}
      </s-text>
      {p.page < p.pages && <Link to={href(p.page + 1)}>Next →</Link>}
    </s-stack>
  );
}

/** Ô số liệu của Dashboard. */
export function Stat(p: { label: string; value: string; hint?: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack direction="block" gap="small-300">
        <s-text color="subdued">{p.label}</s-text>
        <s-heading>{p.value}</s-heading>
        {p.hint && <s-text color="subdued">{p.hint}</s-text>}
      </s-stack>
    </s-box>
  );
}
