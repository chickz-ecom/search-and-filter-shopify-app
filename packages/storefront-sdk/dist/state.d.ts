import type { PublicFilter, UrlState } from "./types";
export declare function readState(search: string, filters: PublicFilter[]): UrlState;
export declare function writeState(state: UrlState, filters: PublicFilter[], base: string): string;
