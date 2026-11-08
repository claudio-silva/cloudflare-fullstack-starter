import type { Kysely } from "kysely";
import type { Database } from "../types/database";
import { ACCOUNT_DISABLED_CODE, ACCOUNT_DISABLED_MESSAGE, ACCOUNT_DISABLED_STATUS, accountDisabledBody } from "../../shared/account-status";
import type { AppContext } from "../types/context";
import { fail } from "./errors";
import { isDisabledAccountSession, sessionTokenFromHeaders } from "./session-revocations";

type Db = Kysely<Database>;

/** A bare response: no `Set-Cookie`, so later requests keep carrying the token. */
const disabledResponse = () => Response.json(accountDisabledBody(), { status: ACCOUNT_DISABLED_STATUS });

/** True when the request's cookie token carries a live disable marker (one read, only on failed paths). */
export async function carriesDisabledToken(headers: Headers, db: Db): Promise<boolean> {
	const token = sessionTokenFromHeaders(headers);
	return !!token && (await isDisabledAccountSession(db, token));
}

/**
 * `GET /api/auth/get-session`: Better Auth answers a missing session with 200
 * and a JSON `null`. For a token a disable ended that becomes 403
 * `account_disabled`. Other responses pass unchanged.
 */
export async function disabledAwareGetSession(response: Response, headers: Headers, db: Db): Promise<Response> {
	if (response.status !== 200) return response;
	const body: unknown = await response.clone().json().catch(() => undefined);
	if (body !== null) return response;
	return (await carriesDisabledToken(headers, db)) ? disabledResponse() : response;
}

/**
 * The rest of Better Auth's catch-all (list-sessions, update-user, ...): a 401
 * for a token a disable ended becomes 403 `account_disabled`. Other responses,
 * including the sign-out that clears the cookie, pass unchanged.
 */
export async function disabledAwareCatchAll(response: Response, headers: Headers, db: Db): Promise<Response> {
	if (response.status !== 401) return response;
	return (await carriesDisabledToken(headers, db)) ? disabledResponse() : response;
}

export type LiveSessionDecision<S> = { session: S; denied?: undefined } | { session?: undefined; denied: Response };

const disabledFail = (c: AppContext, log: string) => fail(c, ACCOUNT_DISABLED_STATUS, ACCOUNT_DISABLED_MESSAGE, { code: ACCOUNT_DISABLED_CODE, level: "info", log });

/**
 * Decides whether a request may proceed: the live session of an enabled user,
 * or the `denied` response. A missing session is the usual 401 unless its
 * cookie token carries a live disable marker (read only then); a session whose
 * user is disabled is 403 `account_disabled`.
 */
export async function denyUnlessLiveSession<S extends { user: unknown }>(c: AppContext, session: S | null, db: Db): Promise<LiveSessionDecision<S>> {
	if (!session) {
		if (await carriesDisabledToken(c.req.raw.headers, db)) return { denied: disabledFail(c, "session ended by a disable") };
		return {
			denied: fail(c, 401, "Your session has expired. Please sign in again.", { code: "unauthenticated", log: "no valid session" }),
		};
	}
	if ((session.user as { disabled?: unknown }).disabled) return { denied: disabledFail(c, "account disabled") };
	return { session };
}
