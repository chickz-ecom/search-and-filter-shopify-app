import type { MessageKey } from "../../i18n";

/** Lỗi sync → gợi ý cách sửa cho merchant (mục 5.5, BFS: lỗi kèm cách sửa). */
export function syncErrorHint(message: string | null | undefined): MessageKey {
  const m = (message ?? "").toLowerCase();
  if (m.includes("count check")) return "sync.fix.count";
  if (m.includes("throttl")) return "sync.fix.throttled";
  if (m.includes("access") || m.includes("401") || m.includes("403") || m.includes("session"))
    return "sync.fix.access";
  if (m.includes("typesense") || m.includes("unavailable")) return "sync.fix.engine";
  return "sync.fix.generic";
}
