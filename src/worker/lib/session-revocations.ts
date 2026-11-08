import { getSessionCookie } from "better-auth/cookies";
import type { Kysely } from "kysely";
import type { Database } from "../types/database";
import { dbTime as at, ignoreConflict } from "../db";
import { ACCOUNT_DISABLED_CODE } from "../../shared/account-status";

/**
 * Markers for the sessions that disabling a user ended (migration 0008), so a
 * request still carrying one is answered 403 `account_disabled` instead of a
 * bare 401. The marker is read only when a request has no live session.
 */

type Db = Kysely<Database>;

/**
 * The session token in the request's cookie (`<token>.<signature>`), or null.
 * The signature is not verified: the token is the secret, and a marker only
 * turns a 401 into the 403 `account_disabled`.
 */
export function sessionTokenFromHeaders(headers: Headers): string | null {
	const raw = getSessionCookie(headers);
	if (!raw) return null;
	return raw.split(".")[0] || null;
}

/**
 * Copies the user's unexpired sessions into markers. Call before the sessions
 * are deleted. Returns how many were copied.
 */
export async function markSessionsDisabled(db: Db, userId: string, now = new Date()): Promise<number> {
	const live = await db.selectFrom("sessions").select(["token", "userId", "expiresAt"]).where("userId", "=", userId).where("expiresAt", ">", at(now)).execute();
	if (live.length === 0) return 0;
	await ignoreConflict(
		db.insertInto("session_revocations").values(live.map((s) => ({ token: s.token, user_id: s.userId, reason: ACCOUNT_DISABLED_CODE, expires_at: s.expiresAt, created_at: at(now) }))),
	).execute();
	return live.length;
}

export async function clearSessionMarkers(db: Db, userId: string): Promise<void> {
	await db.deleteFrom("session_revocations").where("user_id", "=", userId).execute();
}

/** True when `token` has an unexpired marker and its user is still disabled (re-enabling turns markers off at once). */
export async function isDisabledAccountSession(db: Db, token: string, now = new Date()): Promise<boolean> {
	const row = await db
		.selectFrom("session_revocations")
		.innerJoin("users", "users.id", "session_revocations.user_id")
		.select(["session_revocations.token", "users.disabled"])
		.where("session_revocations.token", "=", token)
		.where("session_revocations.reason", "=", ACCOUNT_DISABLED_CODE)
		.where("session_revocations.expires_at", ">", at(now))
		.executeTakeFirst();
	return !!row && Boolean(row.disabled);
}

export async function pruneExpiredSessionMarkers(db: Db, now = new Date()): Promise<number> {
	const result = await db.deleteFrom("session_revocations").where("expires_at", "<=", at(now)).executeTakeFirst();
	return Number(result?.numDeletedRows ?? 0);
}
