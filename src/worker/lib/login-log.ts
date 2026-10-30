import type { AppContext } from "../types/context";
import type { Kysely } from "kysely";
import type { Database } from "../types/database";
import { createDb, databaseKind, dbBool, dbNow } from "../db";

/**
 * Record sign-in attempts, successful and failed.
 *
 * Who signed in, from where and when is the first question anyone asks about a
 * deployed app, and `sessions` cannot answer it: it holds only sessions that
 * still exist, so it forgets every expired login and never saw a failure.
 *
 * Writing is fire-and-forget through `waitUntil`, because an audit record is
 * never a reason to make a user wait, nor to turn a successful sign-in into an
 * error if the insert fails.
 */

/** Paths worth recording. Session reads and sign-outs are noise. */
const SIGN_IN_PATHS = ["/sign-in", "/callback", "/oauth"];

export function isSignOutPath(path: string): boolean {
	return path.endsWith("/sign-out");
}

/** Auth endpoints that end other sessions of the signed-in user. */
const REVOKING_PATHS = ["/revoke-session", "/revoke-sessions", "/revoke-other-sessions", "/change-password"];

export function isRevokingPath(path: string): boolean {
	return REVOKING_PATHS.some((p) => path.endsWith(p));
}

/** The user's live sessions: compare before and after a revoking request to see which ended. */
export async function sessionsOf(db: Kysely<Database>, userId: string) {
	return db.selectFrom("sessions").select(["id", "userId", "ipAddress", "userAgent", "expiresAt"]).where("userId", "=", userId).execute();
}

export function isSignInPath(path: string): boolean {
	return SIGN_IN_PATHS.some((p) => path.includes(p));
}

/**
 * Best-effort extraction of the address being authenticated. Better Auth takes
 * it in the body for password sign-in; an OAuth callback has none, and the row
 * is still worth keeping for the IP and the outcome.
 */
async function emailFromRequest(c: AppContext): Promise<string> {
	try {
		const cloned = c.req.raw.clone();
		const body = (await cloned.json()) as { email?: string } | null;
		return typeof body?.email === "string" ? body.email.slice(0, 254) : "";
	} catch {
		return "";
	}
}

export async function recordLoginAttempt(c: AppContext, success: boolean): Promise<void> {
	await insertEvent(c, { email: await emailFromRequest(c), success, event: "sign-in" });
}

/** The user must be read before the sign-out, which deletes the session. */
export async function recordSignOut(c: AppContext, user: { id: string; email: string }): Promise<void> {
	await insertEvent(c, { email: user.email, userId: user.id, success: true, event: "sign-out" });
}

type EndedSession = { userId: string; ipAddress: string | null; userAgent: string | null; expiresAt: Date | string };

/**
 * A session that ended without the user signing out: it ran past its expiry
 * ("session-expired", dated at the expiry) or was revoked (a password or role
 * change, an admin, "sign out everywhere"). Written from the session's own
 * address and browser, so the entry describes the device that lost access.
 * Never throws: the log must not break what ended the session.
 */
export async function recordSessionEnds(db: Kysely<Database>, sessions: EndedSession[], event: "session-expired" | "session-revoked"): Promise<void> {
	if (sessions.length === 0) return;
	try {
		const ids = [...new Set(sessions.map((s) => s.userId))];
		const users = await db.selectFrom("users").select(["id", "email"]).where("id", "in", ids).execute();
		const emails = new Map(users.map((u) => [u.id, u.email]));
		const stamp = (value: Date | string) => (databaseKind === "sqlite" ? new Date(value).toISOString() : new Date(value));
		await db
			.insertInto("login_events")
			.values(
				sessions.map((s) => ({
					id: crypto.randomUUID(),
					user_id: s.userId,
					email: emails.get(s.userId) ?? "",
					success: dbBool(true, databaseKind),
					ip: s.ipAddress?.slice(0, 64) ?? null,
					user_agent: s.userAgent?.slice(0, 512) ?? null,
					country: null,
					created_at: event === "session-expired" ? stamp(s.expiresAt) : dbNow(databaseKind),
					event,
				})),
			)
			.execute();
	} catch (error) {
		console.error("[auth] could not record the session ending", error);
	}
}

/** Where a request came from: the address, browser and (from Cloudflare's edge) country. */
export type RequestOrigin = { ip: string | null; userAgent: string | null; country: string | null };

export function requestOrigin(c: AppContext): RequestOrigin {
	const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf;
	const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? null;
	return { ip: ip?.slice(0, 64) ?? null, userAgent: c.req.header("User-Agent")?.slice(0, 512) ?? null, country: cf?.country?.slice(0, 2) ?? null };
}

/**
 * An account was deleted. The row keeps the id and email of the account, which
 * no longer exists, and the origin of the request that deleted it (the
 * administrator's, or the user's own for their profile page). Never throws.
 */
export async function recordUserDeleted(db: Kysely<Database>, user: { id: string; email: string }, origin?: RequestOrigin): Promise<void> {
	try {
		await db
			.insertInto("login_events")
			.values({
				id: crypto.randomUUID(),
				user_id: user.id,
				email: user.email,
				success: dbBool(true, databaseKind),
				ip: origin?.ip ?? null,
				user_agent: origin?.userAgent ?? null,
				country: origin?.country ?? null,
				created_at: dbNow(databaseKind),
				event: "user-deleted",
			})
			.execute();
	} catch (error) {
		console.error("[auth] could not record the user deletion", error);
	}
}

async function insertEvent(
	c: AppContext,
	{ email, userId: knownUserId, success, event }: { email: string; userId?: string; success: boolean; event: "sign-in" | "sign-out" },
): Promise<void> {
	const origin = requestOrigin(c);

	const db = createDb(c.env);
	const userId = knownUserId ?? (email
		? ((await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst())?.id ?? null)
		: null);

	await db
		.insertInto("login_events")
		.values({
			id: crypto.randomUUID(),
			user_id: userId,
			email,
			success: dbBool(success, databaseKind),
			ip: origin.ip,
			user_agent: origin.userAgent,
			country: origin.country,
			created_at: dbNow(databaseKind),
			event,
		})
		.execute();
}

/**
 * Delete rows older than `days`. `ip` and `user_agent` are personal data, so
 * this is a requirement rather than housekeeping; it runs on a schedule from
 * `src/worker/scheduled.ts`.
 */
export async function pruneLoginEvents(
	env: Parameters<typeof createDb>[0],
	days: number,
): Promise<number> {
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const value = databaseKind === "sqlite" ? cutoff.toISOString() : cutoff;
	const result = await createDb(env).deleteFrom("login_events").where("created_at", "<", value).executeTakeFirst();
	return Number(result?.numDeletedRows ?? 0);
}
