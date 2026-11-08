/**
 * Password sign-in that never tells an anonymous caller whether an email belongs to a disabled
 * account. The credentials are checked first, so a wrong password gets Better Auth's own answer,
 * the same as for any other email. Only a correct password for a disabled user reaches the session
 * hook (middleware/auth.ts, `databaseHooks.session.create.before`), which refuses; Better Auth then
 * answers 401 with code `FAILED_TO_CREATE_SESSION` (better-auth 1.7.13, `api/routes/sign-in.mjs`:
 * `createSession` returns null, the route throws `UNAUTHORIZED` with that code). That refusal, and
 * only that one, becomes the `account_disabled` answer built by `refuse`.
 */

/** The code Better Auth sends when the session-create hook refuses (and for no other reason on this path). */
export const SESSION_REFUSED_CODE = "FAILED_TO_CREATE_SESSION";

export async function signInWithDisabledGuard(
	request: Request,
	handle: (request: Request) => Promise<Response>,
	isDisabledEmail: (email: string) => Promise<boolean>,
	/** The disabled answer. Built fresh, so no Better Auth header (Set-Cookie) rides along. */
	refuse: () => Response | Promise<Response>,
): Promise<Response> {
	const response = await handle(request.clone());
	if (response.ok) return response;
	const failure = (await response.clone().json().catch(() => null)) as { code?: unknown } | null;
	if (failure?.code !== SESSION_REFUSED_CODE) return response;
	const body = (await request.clone().json().catch(() => null)) as { email?: unknown } | null;
	const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	if (email && (await isDisabledEmail(email))) return refuse();
	return response;
}
