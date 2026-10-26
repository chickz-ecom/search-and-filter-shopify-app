import type { SearchAppContext } from "./types";
export declare class SearchAppError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare class Client {
    private readonly ctx;
    private readonly fetchImpl;
    private readonly timeoutMs;
    private inflight;
    private cache;
    constructor(ctx: SearchAppContext, fetchImpl?: typeof fetch, timeoutMs?: number);
    url(path: string, params?: Record<string, string | number | undefined | null>): string;
    get<T>(path: string, params?: Record<string, string | number | undefined | null>, ttlMs?: number): Promise<T>;
    /** Beacon analytics (không chặn điều hướng). */
    beacon(events: unknown[]): void;
}
