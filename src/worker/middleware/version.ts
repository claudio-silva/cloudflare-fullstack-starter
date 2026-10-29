import { APP_VERSION } from "../../shared/app-version";
import {
	APP_VERSION_HEADER,
	CLIENT_ERRORS_PATH,
	CLIENT_INCOMPATIBLE_CODE,
	CLIENT_VERSION_HEADER,
	isBreakingChange,
} from "../../shared/http-contract";
import { fail } from "../lib/errors";
import type { AppContext } from "../types/context";

/**
 * Stamps every response with the version of the code that produced it, and
 * gives every request an id.
 *
 * The version header is how an open tab learns that the server has moved on
 * without it (src/react-app/lib/http/version.ts): the browser compares it with
 * the version it was built with, on every API response, at no extra cost.
 *
 * The browser sends its own version back in `X-Client-Version`. It is logged
 * with every error, so a failure can be traced to a stale tab. And a tab a
 * major version away (`isBreakingChange`: a release that changed the API, or
 * a rollback across one) has its API requests refused with a 426
 * (`code: "client_incompatible"`) before they can do anything, which makes the
 * tab ask the user to update before going on. Requests that do not say their
 * version (other clients, libraries the browser layer does not stamp) are never
 * refused, and neither are error reports: an old tab's errors are the ones
 * worth hearing.
 *
 * Runs first, so even maintenance responses and errors carry the header.
 */
export async function versionMiddleware(c: AppContext, next: () => Promise<void>): Promise<Response | void> {
	c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
	if (isIncompatible(c)) {
		const response = fail(c, 426, "This page was built for another version of the app. Reload it to continue.", {
			code: CLIENT_INCOMPATIBLE_CODE,
			log: `client ${clientVersionOf(c)} is incompatible with ${APP_VERSION}`,
		});
		response.headers.set(APP_VERSION_HEADER, APP_VERSION);
		return response;
	}
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

function isIncompatible(c: AppContext): boolean {
	const client = clientVersionOf(c);
	if (!client || !c.req.path.startsWith("/api/") || c.req.path === CLIENT_ERRORS_PATH) return false;
	return isBreakingChange(client, APP_VERSION);
}
