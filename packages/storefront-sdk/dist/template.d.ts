type Node = {
    t: "text";
    v: string;
} | {
    t: "var";
    path: string;
    filters: [string, string | undefined][];
} | {
    t: "if";
    path: string;
    neg: boolean;
    yes: Node[];
    no: Node[];
} | {
    t: "each";
    path: string;
    body: Node[];
    empty: Node[];
};
export type Helpers = {
    money?: (v: number) => string;
};
export declare const escapeHtml: (v: unknown) => string;
export declare function compile(src: string): Node[];
export declare function render(src: string, data: unknown, helpers?: Helpers): string;
export {};
