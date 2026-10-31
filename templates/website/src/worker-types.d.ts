/**
 * The handful of Workers runtime types the website's Worker uses.
 *
 * Deliberately not the app's generated `worker-configuration.d.ts`: that file
 * types the app's bindings and pulls the app's whole source in with it
 * (`mainModule: typeof import("./src/worker/index")`). The website Worker
 * shares nothing with the app, and its typecheck should say so.
 *
 * Everything else (Request, Response, URL, fetch) comes from the DOM lib,
 * whose shapes the Workers runtime implements.
 */

interface HTMLRewriterElement {
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	remove(): void;
}

declare class HTMLRewriter {
	on(selector: string, handlers: { element?(element: HTMLRewriterElement): void }): HTMLRewriter;
	transform(response: Response): Response;
}

/** The `[assets]` binding: static files, as a fetchable service. */
type Fetcher = {
	fetch(request: Request): Promise<Response>;
};
