import type { SearchAppEvent } from "./types";

// Event bus nội bộ + DOM CustomEvent trên document (mục 6.4b): searchapp:ready, searchapp:before-search, …
type Handler = (payload: unknown) => void;

export class Emitter {
  private map = new Map<string, Set<Handler>>();

  on(event: SearchAppEvent, fn: Handler): () => void {
    let set = this.map.get(event);
    if (!set) this.map.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  off(event: SearchAppEvent, fn: Handler) {
    this.map.get(event)?.delete(fn);
  }

  /** Phát cho listener JS rồi DOM event `searchapp:<event>` (":" → "-"). Trả false nếu DOM event bị preventDefault. */
  emit(event: SearchAppEvent, payload: unknown, cancelable = false): boolean {
    for (const fn of this.map.get(event) ?? []) {
      try {
        fn(payload);
      } catch (e) {
        console.error("[SearchApp]", e);
      }
    }
    if (typeof document === "undefined") return true;
    const ev = new CustomEvent(`searchapp:${event.replace(":", "-")}`, {
      detail: payload,
      cancelable,
    });
    return document.dispatchEvent(ev);
  }
}
