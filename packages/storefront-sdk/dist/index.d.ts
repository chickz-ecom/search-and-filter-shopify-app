import type { SearchAppContext, SearchAppSDK } from "./types";
export type * from "./types";
declare global {
    interface Window {
        SearchApp?: SearchAppSDK;
        SearchAppContext?: SearchAppContext;
    }
}
