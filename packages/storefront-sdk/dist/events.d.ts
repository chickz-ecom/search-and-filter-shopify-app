import type { SearchAppEvent } from "./types";
type Handler = (payload: unknown) => void;
export declare class Emitter {
    private map;
    on(event: SearchAppEvent, fn: Handler): () => void;
    off(event: SearchAppEvent, fn: Handler): void;
    /** Phát cho listener JS rồi DOM event `searchapp:<event>` (":" → "-"). Trả false nếu DOM event bị preventDefault. */
    emit(event: SearchAppEvent, payload: unknown, cancelable?: boolean): boolean;
}
export {};
