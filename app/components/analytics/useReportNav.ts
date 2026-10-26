import { useRef } from "react";
import { useSearchParams } from "react-router";

/** Điều khiển bảng báo cáo qua URL (tab, ô tìm có debounce, sắp xếp, trang) — giữ nguyên from/to. */
export function useReportNav() {
  const [, setParams] = useSearchParams();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = (patch: Record<string, string | null>, replace = false) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace, preventScrollReset: true },
    );
  return {
    onTab: (tab: string) => update({ tab, q: null, sort: null, dir: null, page: null }),
    onQuery: (q: string) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => update({ q: q.trim() || null, page: null }, true), 300);
    },
    onSort: (sort: string, dir: "asc" | "desc") => update({ sort, dir, page: null }),
    onPage: (page: number) => update({ page: String(page) }),
  };
}
