import { ACCOUNT_DISABLED_PATH, REAUTH_ACCOUNT_DISABLED_ERROR, REAUTH_COMPLETE_PATH } from "../../shared/account-status";

/**
 * Sign-in that never tells an anonymous caller whether an email belongs to a disabled account. The
 * proof (password, provider, inbox) is checked first, so a wrong one gets Better Auth's own answer,
 * the same as for any other account. Only a sign-in that would have succeeded reaches the session
 * hook (middleware/auth.ts, `databaseHooks.session.create.before`), which refuses a disabled user
 * and sets `sessionRefusedForDisabled` on the request's context (per request, never module state).
 * No email lookup is needed: the hook already knows.
 *
 * What Better Auth 1.7.14 answers when that hook refuses, per route (node_modules/better-auth/dist):
 *  - `POST /sign-in/email` (`api/routes/sign-in.mjs`): 401 JSON `FAILED_TO_CREATE_SESSION`;
 *  - `POST /sign-in/social` with an `idToken` (same file, `OAUTH_LINK_ERROR`): 401 JSON, message
 *    "unable to create session" (`oauth2/link-account.mjs`);
 *  - `GET /callback/:provider` (`api/routes/callback.mjs`): 302 to the error URL (the `errorCallbackURL`
 *    the client sent, else Better Auth's error page) with `error=unable_to_create_session`, appended
 *    with `&` when the URL already has a query;
 *  - `GET /verify-email` with `autoSignInAfterVerification` (`api/routes/email-verification.mjs`): 500
 *    JSON `FAILED_TO_CREATE_SESSION`, never a redirect, though the email is already marked verified;
 *  - `GET /magic-link/verify` (plugin, not installed here): 302 to the error URL with
 *    `error=failed_to_create_session`.
 */
export function isSessionCreatingAuthRequest(method: string, path: string): boolean {
	if (method === "POST") return /\/sign-in\/[^/]+$/.test(path);
	if (method === "GET") return /\/callback\/[^/]+$/.test(path) || path.endsWith("/verify-email") || path.endsWith("/magic-link/verify");
	return false;
}

const REFUSED_SESSION_ERRORS = new Set(["unable_to_create_session", "failed_to_create_session"]);

async function isJsonSessionRefusal(response: Response): Promise<boolean> {
	if (response.status < 400) return false;
	const failure = (await response.clone().json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
	if (failure?.code === "FAILED_TO_CREATE_SESSION") return true;
	return failure?.code === "OAUTH_LINK_ERROR" && failure.message === "unable to create session";
}

/** The Location of a redirect that carries a refused-session `error`, as a URL; null for any other response. */
function refusedRedirectTarget(response: Response): URL | null {
	if (response.status < 300 || response.status >= 400) return null;
	const location = response.headers.get("location");
	if (!location) return null;
	try {
		const target = new URL(location, "http://placeholder.invalid");
		// getAll: an error URL may already carry `?error=1` of its own, and Better Auth appends its code after it.
		return target.searchParams.getAll("error").some((error) => REFUSED_SESSION_ERRORS.has(error.toLowerCase())) ? target : null;
	} catch {
		return null;
	}
}

/**
 * Where a refused redirect goes: the account-disabled page, or, when the error URL was the re-login
 * popup's completion page, that page with `error=account_disabled` so it can tell the opener (which
 * sends its tab to the account-disabled page). A same-origin relative URL only: nothing from the
 * request is echoed.
 */
function disabledRedirect(target: URL): string {
	return target.pathname === REAUTH_COMPLETE_PATH ? `${REAUTH_COMPLETE_PATH}?error=${REAUTH_ACCOUNT_DISABLED_ERROR}` : ACCOUNT_DISABLED_PATH;
}

/**
 * Runs a session-creating request. A failure the hook made for a disabled user (`refusedForDisabled`,
 * read after the handler ran) becomes `refuse()` (the shared 403 `account_disabled` answer, built
 * fresh so no Better Auth header rides along) for a JSON route, or a redirect for a redirecting GET
 * that cannot answer JSON. Any other failure, and a refusal the hook did not make, passes through.
 */
export async function signInWithDisabledGuard(
	request: Request,
	handle: (request: Request) => Promise<Response>,
	refusedForDisabled: () => boolean,
	refuse: () => Response | Promise<Response>,
): Promise<Response> {
	// A clone: the caller reads the body again to record a failed sign-in.
	const response = await handle(request.clone());
	if (response.ok || !refusedForDisabled()) return response;
	if (await isJsonSessionRefusal(response)) return refuse();
	const target = refusedRedirectTarget(response);
	if (target) {
		const headers = new Headers({ location: disabledRedirect(target) });
		// Keep the cookie deletions (OAuth state) Better Auth made; a refusal carries no session cookie.
		for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
		return new Response(null, { status: 302, headers });
	}
	return response;
}
