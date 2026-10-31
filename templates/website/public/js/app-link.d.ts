/**
 * Types for `app-link.js`, which is plain ESM on purpose — the browser loads
 * that exact file, with no build step between. The declarations are only so
 * that TypeScript callers (the unit tests, and any tool of your own) see what
 * it exports.
 */
export declare const THEMES: readonly ["light", "dark", "system"];
export declare const STORAGE_KEY: "app-theme";
export declare function resolveTheme(value: unknown): "light" | "dark" | "system";
export declare function effectiveTheme(theme: unknown, prefersDark: boolean): "light" | "dark";
export declare function withTheme(href: string, theme: unknown, base?: string): string;
