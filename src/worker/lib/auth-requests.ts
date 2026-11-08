import type { AppContext } from "../types/context";
import { SESSION_CHANGED_CODE, SESSION_CHANGED_MESSAGE, SESSION_ID_HEADER } from "../../shared/session-binding";
import { failForAuthClient } from "./errors";

/**
 * The session id the tab says it was loaded under (`X-Session-Id`). Null when the request carries
 * none, which means no binding check (CLI, beacons, curl, old clients).
 */
export function claimedSessionId(c: AppContext): string | null {
	return c.req.header(SESSION_ID_HEADER) || null;
}

/**
 * `/api/auth/*` endpoints that never carry the per-tab binding check: the session probe and the
 * sign-in / sign-out / account-recovery flows, where a stale or missing session is the normal case.
 * The ONE allow-list; anything not listed (update-user, change-email, change-password,
 * list-sessions, revoke-session(s), delete-user, unlink-account, ...) is checked, so a stale tab
 * cannot change the account the cookie holds now.
 */
export const BINDING_EXEMPT_AUTH_SEGMENTS: readonly string[] = [
	"get-session",
	"sign-in",
	"sign-up",
	"sign-out",
	"request-password-reset",
	"forget-password",
	"reset-password",
	"verify-email",
	"send-verification-email",
	"magic-link",
	"callback",
	"error",
	"ok",
];

export function isBindingExemptAuthPath(path: string): boolean {
	const rest = path.replace(/^\/api\/auth\/?/, "");
	const first = rest.split("/")[0] ?? "";
	return BINDING_EXEMPT_AUTH_SEGMENTS.includes(first);
}

type SessionReader = {
	api: { getSession(args: { headers: Headers; query?: { disableRefresh?: boolean } }): Promise<{ session: { id?: unknown } } | null> };
};

/**
 * True when the cookie resolves to a session other than the tab's claimed one. Costs one session
 * lookup (no refresh), paid only by the rare account-changing calls that carry an id: Better Auth's
 * catch-all gives no way to read the session it loads. No session at all is not stale: the handler
 * answers 401 itself.
 */
export async function isStaleTab(c: AppContext, auth: SessionReader): Promise<boolean> {
	const claimed = claimedSessionId(c);
	if (claimed === null) return false;
	const current = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
	return !!current && current.session.id !== claimed;
}

/**
 * Account-changing Better Auth routes act on whatever account the cookie holds now, so a stale tab
 * is refused with 409 before Better Auth runs. Null when the request may proceed.
 */
export async function refuseStaleAuthRequest(c: AppContext, makeAuth: () => SessionReader): Promise<Response | null> {
	if (claimedSessionId(c) === null || isBindingExemptAuthPath(c.req.path)) return null;
	if (!(await isStaleTab(c, makeAuth()))) return null;
	return failForAuthClient(c, 409, SESSION_CHANGED_MESSAGE, { code: SESSION_CHANGED_CODE, level: "info", log: "stale tab refused on an account route" });
}
