/**
 * `fetch`, opted in to the HTTP layer (lib/http/interceptor.ts). Use it for
 * every call to the app's own API:
 *
 *   const res = await http("/api/posts");              // errors handled for you
 *   const res = await http(url, { handles: [404] });   // a 404 is yours
 *
 * All it does is give `handles` a default of `[]` — "managed, and I handle no
 * status myself" — so call sites need no ceremony. Plain `fetch` without
 * `handles` is left alone by the layer, which keeps code and libraries that
 * know nothing about it working as they always did.
 */
export function http(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
	return fetch(input, { ...init, handles: init.handles === undefined ? [] : init.handles });
}

