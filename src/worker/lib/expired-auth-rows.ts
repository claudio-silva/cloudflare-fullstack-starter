import { createDb, databaseKind } from "../db";
import { recordSessionEnds } from "./login-log";

/**
 * Delete expired sessions and verification tokens.
 *
 * Better Auth removes an expired session only when that same session is looked
 * up again, which a visitor who never comes back never does; verification
 * tokens that were never used stay forever too. Without this, both tables grow
 * with every sign-in for the life of the app — fastest on a public deployment
 * such as the demo, where every visitor signs in. Runs from
 * `src/worker/scheduled.ts`. Expired sessions are recorded in `login_events`
 * as "session-expired" before they go.
 */
export async function pruneExpiredAuthRows(env: Parameters<typeof createDb>[0]): Promise<number> {
	const now = new Date();
	const value = databaseKind === "sqlite" ? now.toISOString() : now;
	const db = createDb(env);
	let deleted = 0;
	// Each expired session goes in the sign-in log first: the log is the only place that remembers it.
	const expired = await db.selectFrom("sessions").select(["id", "userId", "ipAddress", "userAgent", "createdAt", "updatedAt", "expiresAt"]).where("expiresAt", "<", value).execute();
	await recordSessionEnds(db, expired, "session-expired");
	for (const table of ["sessions", "verifications"] as const) {
		const result = await db.deleteFrom(table).where("expiresAt", "<", value).executeTakeFirst();
		deleted += Number(result?.numDeletedRows ?? 0);
	}
	return deleted;
}
