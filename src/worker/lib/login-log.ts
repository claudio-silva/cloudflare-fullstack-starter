import type { AppContext } from "../types/context";
import type { Kysely } from "kysely";
import type { Database } from "../types/database";
import { createDb, databaseKind, dbBool, dbNow, ignoreConflict } from "../db";

/**
 * The sign-in log (`login_events`) and the per-user totals (`user_stats`).
 *
 * Who signed in, from where and when is the first question anyone asks about a
 * deployed app, and `sessions` cannot answer it: it holds only sessions that
 * still exist, so it forgets every expired login and never saw a failure. The
 * log keeps every sign-in, failed attempt, sign-out, session that ended without
 * one, and account deletion, permanently unless `AUTH_LOG_RETENTION_DAYS` is
 * set. `user_stats` keeps the running totals (sign-ins, failures, time in
 * session, last sign-in), so they survive pruning and serve the lists.
 *
 * Time in session is from sign-in to sign-out; for a session that expired or
 * was revoked, to its last use, since the user was not there when it ended.
 *
 * Every write here swallows its own errors: an audit record is never a reason
 * to fail, or slow down, what it records.
 */

type Db = Kysely<Database>;

/** Where a request came from: the address, browser and (from Cloudflare's edge) country. */
export type RequestOrigin = { ip: string | null; userAgent: string | null; country: string | null };

export function requestOrigin(c: AppContext): RequestOrigin {
	const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf;
	const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? null;
	return { ip: ip?.slice(0, 64) ?? null, userAgent: c.req.header("User-Agent")?.slice(0, 512) ?? null, country: cf?.country?.slice(0, 2) ?? null };
}

/** Auth endpoints whose failure is a failed sign-in. Successful sign-ins are recorded when their session is created (`recordSignIn`). */
export function isSignInPath(path: string): boolean {
	return /\/sign-in\/email$/.test(path);
}

export function isSignOutPath(path: string): boolean {
	return path.endsWith("/sign-out");
}

/** Auth endpoints that end other sessions of the signed-in user. */
const REVOKING_PATHS = ["/revoke-session", "/revoke-sessions", "/revoke-other-sessions", "/change-password"];

export function isRevokingPath(path: string): boolean {
	return REVOKING_PATHS.some((p) => path.endsWith(p));
}

/** A session as stored, with what the log needs from it. */
export type SessionRow = {
	id: string;
	userId: string;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: Date | string;
	updatedAt: Date | string;
	expiresAt: Date | string;
};

/** The user's live sessions: compare before and after a revoking request to see which ended. */
export async function sessionsOf(db: Db, userId: string): Promise<SessionRow[]> {
	return db.selectFrom("sessions").select(["id", "userId", "ipAddress", "userAgent", "createdAt", "updatedAt", "expiresAt"]).where("userId", "=", userId).execute();
}

const stamp = (value: Date | string) => (databaseKind === "sqlite" ? new Date(value).toISOString() : new Date(value));
const seconds = (from: Date | string, to: Date | string) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));

type Totals = { signIns?: number; failedSignIns?: number; sessionSeconds?: number; lastSignInAt?: Date | string };

/** Adds to a user's running totals, creating their row on first use. Portable: an insert that ignores conflicts, then an increment. */
async function addTotals(db: Db, userId: string, totals: Totals): Promise<void> {
	await ignoreConflict(db.insertInto("user_stats").values({ user_id: userId, last_sign_in_at: null })).execute();
	await db
		.updateTable("user_stats")
		.set((eb) => ({
			sign_ins: eb("sign_ins", "+", totals.signIns ?? 0),
			failed_sign_ins: eb("failed_sign_ins", "+", totals.failedSignIns ?? 0),
			session_seconds: eb("session_seconds", "+", totals.sessionSeconds ?? 0),
			...(totals.lastSignInAt ? { last_sign_in_at: stamp(totals.lastSignInAt) } : {}),
		}))
		.where("user_id", "=", userId)
		.execute();
}

type EventRow = {
	userId: string | null;
	email: string;
	success: boolean;
	event: Database["login_events"]["event"];
	origin: RequestOrigin;
	at?: Date | string;
	method?: string | null;
	sessionId?: string | null;
	actorId?: string | null;
	durationSeconds?: number | null;
};

function insertEvents(db: Db, rows: EventRow[]) {
	return db
		.insertInto("login_events")
		.values(
			rows.map((r) => ({
				id: crypto.randomUUID(),
				user_id: r.userId,
				email: r.email.slice(0, 254),
				success: dbBool(r.success, databaseKind),
				ip: r.origin.ip,
				user_agent: r.origin.userAgent,
				country: r.origin.country,
				created_at: r.at ? stamp(r.at) : dbNow(databaseKind),
				event: r.event,
				method: r.method ?? null,
				session_id: r.sessionId ?? null,
				actor_id: r.actorId ?? null,
				duration_seconds: r.durationSeconds ?? null,
			})),
		)
		.execute();
}

async function emailsOf(db: Db, ids: string[]): Promise<Map<string, string>> {
	if (ids.length === 0) return new Map();
	const users = await db.selectFrom("users").select(["id", "email"]).where("id", "in", ids).execute();
	return new Map(users.map((u) => [u.id, u.email]));
}

async function safely(what: string, work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		console.error(`[auth] could not record ${what}`, error);
	}
}

/**
 * How a session was authenticated, from the Better Auth endpoint that created
 * it: "password", the OAuth provider's id, or null for a session that is not a
 * sign-in (a password change replaces the current session).
 */
export function signInMethod(path: string | undefined, params?: Record<string, string>): string | null {
	if (!path) return null;
	if (path.startsWith("/callback/") || path.startsWith("/oauth2/callback/")) return (params?.id ?? params?.providerId ?? path.split("/").pop() ?? "oauth").slice(0, 16);
	if (path.startsWith("/sign-in/email") || path.startsWith("/sign-up/email")) return "password";
	if (path.startsWith("/verify-email")) return "email-link";
	return null;
}

/** A session was created by a sign-in. Called from Better Auth's session hook (middleware/auth.ts). */
export async function recordSignIn(db: Db, session: Pick<SessionRow, "id" | "userId">, method: string, origin: RequestOrigin): Promise<void> {
	await safely("the sign-in", async () => {
		const email = (await emailsOf(db, [session.userId])).get(session.userId) ?? "";
		const now = new Date();
		await insertEvents(db, [{ userId: session.userId, email, success: true, event: "sign-in", origin, at: now, method, sessionId: session.id }]);
		await addTotals(db, session.userId, { signIns: 1, lastSignInAt: now });
	});
}

async function emailFromBody(c: AppContext): Promise<string> {
	try {
		const body = (await c.req.raw.clone().json()) as { email?: string } | null;
		return typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	} catch {
		return "";
	}
}

/** Whether a password sign-in is for an account that has been disabled. */
export async function isDisabledAccount(c: AppContext): Promise<boolean> {
	const email = await emailFromBody(c);
	if (!email) return false;
	const user = await createDb(c.env).selectFrom("users").select("disabled").where("email", "=", email).executeTakeFirst();
	return Boolean(user?.disabled);
}

/**
 * A password sign-in that failed. The address comes from the request body;
 * when it belongs to nobody, the row has no user.
 */
export async function recordFailedSignIn(c: AppContext): Promise<void> {
	await safely("the failed sign-in", async () => {
		// No address in the body: the row is still kept for the IP and the outcome.
		const email = await emailFromBody(c);
		const db = createDb(c.env);
		const userId = email ? ((await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst())?.id ?? null) : null;
		await insertEvents(db, [{ userId, email, success: false, event: "sign-in", origin: requestOrigin(c), method: "password" }]);
		if (userId) await addTotals(db, userId, { failedSignIns: 1 });
	});
}

/** The user signed out: the session is read before the sign-out deletes it. Its time runs to now. */
export async function recordSignOut(c: AppContext, user: { id: string; email: string }, session: Pick<SessionRow, "id" | "createdAt">): Promise<void> {
	await safely("the sign-out", async () => {
		const db = createDb(c.env);
		const durationSeconds = seconds(session.createdAt, new Date());
		await insertEvents(db, [{ userId: user.id, email: user.email, success: true, event: "sign-out", origin: requestOrigin(c), sessionId: session.id, durationSeconds }]);
		await addTotals(db, user.id, { sessionSeconds: durationSeconds });
	});
}

/**
 * Sessions that ended without the user signing out: they ran past their expiry
 * ("session-expired", dated at the expiry) or were revoked (a password or role
 * change, an admin, "sign out everywhere"). Each counts from sign-in to its
 * last use. Written with the session's own address and browser, so the entry
 * describes the device that lost access; `actorId` is whoever revoked them,
 * when it was someone else.
 */
export async function recordSessionEnds(db: Db, sessions: SessionRow[], event: "session-expired" | "session-revoked", actorId?: string | null): Promise<void> {
	if (sessions.length === 0) return;
	await safely("the session ending", async () => {
		const emails = await emailsOf(db, [...new Set(sessions.map((s) => s.userId))]);
		const rows = sessions.map((s) => ({
			userId: s.userId,
			email: emails.get(s.userId) ?? "",
			success: true,
			event,
			origin: { ip: s.ipAddress?.slice(0, 64) ?? null, userAgent: s.userAgent?.slice(0, 512) ?? null, country: null },
			at: event === "session-expired" ? s.expiresAt : new Date(),
			sessionId: s.id,
			actorId: actorId && actorId !== s.userId ? actorId : null,
			durationSeconds: seconds(s.createdAt, s.updatedAt),
		}));
		await insertEvents(db, rows);
		for (const r of rows) await addTotals(db, r.userId, { sessionSeconds: r.durationSeconds });
	});
}

/**
 * An account was deleted. The row keeps the id and email of the account, which
 * no longer exists, `actor_id` for who deleted it (the user themselves from
 * their profile, an admin, or null for the CLI), and the origin of that request.
 * The user's `user_stats` row stays, like the rest of their history.
 */
export async function recordUserDeleted(db: Db, user: { id: string; email: string }, actorId: string | null, origin?: RequestOrigin): Promise<void> {
	await safely("the user deletion", async () => {
		await insertEvents(db, [
			{ userId: user.id, email: user.email, success: true, event: "user-deleted", origin: origin ?? { ip: null, userAgent: null, country: null }, actorId },
		]);
	});
}

/**
 * Delete rows older than `days`. Off unless `AUTH_LOG_RETENTION_DAYS` is set
 * (src/worker/scheduled.ts): the log is a permanent history by default, and
 * `user_stats` keeps the totals whatever is deleted here.
 */
export async function pruneLoginEvents(env: Parameters<typeof createDb>[0], days: number): Promise<number> {
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const value = databaseKind === "sqlite" ? cutoff.toISOString() : cutoff;
	const result = await createDb(env).deleteFrom("login_events").where("created_at", "<", value).executeTakeFirst();
	return Number(result?.numDeletedRows ?? 0);
}
