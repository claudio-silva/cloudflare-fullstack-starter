import { APP_VERSION } from "../../shared/app-version";
import { APP_VERSION_HEADER, CLIENT_VERSION_HEADER } from "../../shared/http-contract";
import type { AppContext } from "../types/context";

/**
 * Stamps every response with the version of the code that produced it, and
 * gives every request an id.
 *
 * The version header is how an open tab learns that the server has moved on
 * without it (src/react-app/lib/http/version.ts): the browser compares it with
 * the version it was built with, on every API response, at no extra cost.
 *
 * The browser sends its own version back in `X-Client-Version`. Nothing is
 * refused on it today; it is logged with every error, so a failure can be
 * traced to a stale tab, and it is there for a future "minimum client version"
 * rule should an API ever have to change incompatibly.
 *
 * Runs first, so even maintenance responses and errors carry the header.
 */
export async function versionMiddleware(c: AppContext, next: () => Promise<void>) {
	c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
	await next();
	try {
		c.res.headers.set(APP_VERSION_HEADER, APP_VERSION);
	} catch {
		// A response built from another fetch has immutable headers: copy it.
		c.res = new Response(c.res.body, c.res);
		c.res.headers.set(APP_VERSION_HEADER, APP_VERSION);
	}
}

/** The version the calling tab was built with, when it said. */
export function clientVersionOf(c: AppContext): string | undefined {
	return c.req.header(CLIENT_VERSION_HEADER);
}
