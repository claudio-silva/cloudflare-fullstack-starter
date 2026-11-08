/**
 * Wire contract for per-tab session binding. A tab sends the Better Auth `session.id` it was
 * loaded under with every same-origin `/api/` request (`X-Session-Id`). When it differs from the
 * session the cookie resolves to now (another tab signed in, or the session was replaced), the
 * server answers HTTP 409 with this body before any handler runs, so the stale page changed
 * nothing. No id on the request means no check (CLI with an API key, beacons, curl, old clients).
 * The sign-in and recovery endpoints under `/api/auth/` are exempt (worker/lib/auth-requests.ts).
 */
export const SESSION_CHANGED_CODE = "session_changed" as const;
export const SESSION_CHANGED_STATUS = 409 as const;
export const SESSION_CHANGED_MESSAGE = "The session changed.";
export const SESSION_ID_HEADER = "x-session-id";
export type SessionChangedBody = { error: string; code: typeof SESSION_CHANGED_CODE };

/** The body a session-changed refusal carries (the client reads `code`). */
export function sessionChangedBody(): SessionChangedBody {
	return { error: SESSION_CHANGED_MESSAGE, code: SESSION_CHANGED_CODE };
}

/** True for `{ code: "session_changed", error: string }`; false for anything else, including null. */
export function isSessionChangedBody(body: unknown): body is SessionChangedBody {
	if (typeof body !== "object" || body === null) return false;
	const b = body as Record<string, unknown>;
	return b.code === SESSION_CHANGED_CODE && typeof b.error === "string";
}
