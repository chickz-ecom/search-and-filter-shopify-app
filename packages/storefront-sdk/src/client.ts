import type { SearchAppContext } from "./types";

// HTTP client tới search-api / app proxy: timeout, gộp request trùng đang bay, cache phiên ngắn.

export class SearchAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SearchAppError";
  }
}

export class Client {
  private inflight = new Map<string, Promise<unknown>>();
  private cache = new Map<string, { at: number; v: unknown }>();

  constructor(
    private readonly ctx: SearchAppContext,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly timeoutMs = 3000,
  ) {}

  /** App proxy cùng origin: gửi cookie (store có mật khẩu sẽ 302 về /password nếu thiếu). API trực tiếp: không. */
  private get credentials(): RequestCredentials {
    return this.ctx.proxy ? "same-origin" : "omit";
  }

  url(path: string, params: Record<string, string | number | undefined | null> = {}): string {
    const base = this.ctx.apiBase.replace(/\/$/, "");
    const u = new URL(
      `${base}/v1/${path}`,
      typeof location !== "undefined" ? location.href : "https://localhost/",
    );
    if (!this.ctx.proxy) {
      u.searchParams.set("shop", this.ctx.shop);
      u.searchParams.set("key", this.ctx.publicKey);
    }
    u.searchParams.set("locale", this.ctx.locale);
    if (this.ctx.country) u.searchParams.set("country", this.ctx.country);
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    return u.toString();
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | undefined | null>,
    ttlMs = 30_000,
  ): Promise<T> {
    const url = this.url(path, params);
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
    const pending = this.inflight.get(url);
    if (pending) return pending as Promise<T>;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timer = setTimeout(() => ctrl?.abort(), this.timeoutMs);
    const p = this.fetchImpl(url, { signal: ctrl?.signal, credentials: this.credentials })
      .then(async (r) => {
        if (!r.ok) throw new SearchAppError(`HTTP ${r.status}`, r.status);
        const v = (await r.json()) as T;
        this.cache.set(url, { at: Date.now(), v });
        if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value as string);
        return v;
      })
      .catch((e: unknown) => {
        if (e instanceof SearchAppError) throw e;
        throw new SearchAppError(String((e as Error)?.message ?? e), 0);
      })
      .finally(() => {
        clearTimeout(timer);
        this.inflight.delete(url);
      });
    this.inflight.set(url, p);
    return p;
  }

  /** Beacon analytics (không chặn điều hướng). */
  beacon(events: unknown[]) {
    const url = this.url("events");
    const body = JSON.stringify({ events });
    if (typeof navigator !== "undefined" && navigator.sendBeacon && navigator.sendBeacon(url, body))
      return;
    void this.fetchImpl(url, {
      method: "POST",
      body,
      keepalive: true,
      credentials: this.credentials,
    }).catch(() => undefined);
  }
}
