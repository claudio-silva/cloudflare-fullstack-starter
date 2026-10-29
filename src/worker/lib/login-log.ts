import type { AppContext } from "../types/context";
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

async function insertEvent(
	c: AppContext,
	{ email, userId: knownUserId, success, event }: { email: string; userId?: string; success: boolean; event: "sign-in" | "sign-out" },
): Promise<void> {
	const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf;
	const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? null;

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
			ip: ip?.slice(0, 64) ?? null,
			user_agent: c.req.header("User-Agent")?.slice(0, 512) ?? null,
			country: cf?.country?.slice(0, 2) ?? null,
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
