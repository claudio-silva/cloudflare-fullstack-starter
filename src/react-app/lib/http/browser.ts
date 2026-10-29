/**
 * The browser globals the HTTP layer touches, reached through `globalThis` and
 * typed by hand.
 *
 * The layer is also compiled and tested under the Workers types, which have no
 * DOM: `location`, `history` and `document` do not exist there, and neither do
 * events such as `pagehide`. Every use is optional-chained, so in the tests
 * they are simply absent and the code that needs them does nothing.
 */

type Listener = (event: Event) => void;

export type BrowserGlobals = {
	location?: {
		href: string;
		origin: string;
		pathname: string;
		search: string;
		assign(url: string): void;
		replace(url: string): void;
		reload(): void;
	};
	history?: {
		pushState(data: unknown, unused: string, url?: string | URL | null): void;
		replaceState(data: unknown, unused: string, url?: string | URL | null): void;
	};
	document?: {
		visibilityState: string;
		addEventListener(type: string, listener: Listener): void;
		removeEventListener(type: string, listener: Listener): void;
	};
	navigator?: { onLine?: boolean; sendBeacon?(url: string, data: Blob): boolean };
	sessionStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
	addEventListener?(type: string, listener: Listener): void;
	removeEventListener?(type: string, listener: Listener): void;
	dispatchEvent?(event: Event): boolean;
};

export const browser = globalThis as unknown as BrowserGlobals;
