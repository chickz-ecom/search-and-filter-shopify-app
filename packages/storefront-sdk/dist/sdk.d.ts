import type { Pricer } from "./pricing";
import type { SearchAppContext, SearchAppSDK } from "./types";
export declare const VERSION = "1.2.0";
export type SdkDeps = {
    fetch?: typeof fetch;
    pricer?: Pricer;
    win?: Pick<Window, "location" | "history"> & Partial<Pick<Window, "addEventListener">>;
};
export declare function createSDK(ctx: SearchAppContext, deps?: SdkDeps): SearchAppSDK;
/** data-searchapp-mount="results" data-per-page="24" … (mục 6.4e). */
export declare function autoMount(sdk: SearchAppSDK, root?: ParentNode): void;
