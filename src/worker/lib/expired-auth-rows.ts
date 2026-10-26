import { createDb, databaseKind } from "../db";

/**
 * Delete expired sessions and verification tokens.
 *
 * Better Auth removes an expired session only when that same session is looked
 * up again, which a visitor who never comes back never does; verification
 * tokens that were never used stay forever too. Without this, both tables grow
 * with every sign-in for the life of the app — fastest on a public deployment
 * such as the demo, where every visitor signs in. Runs from
 * `src/worker/scheduled.ts`.
 */
export async function pruneExpiredAuthRows(env: Parameters<typeof createDb>[0]): Promise<number> {
	const now = new Date();
	const value = databaseKind === "sqlite" ? now.toISOString() : now;
	const db = createDb(env);
	let deleted = 0;
	for (const table of ["sessions", "verifications"] as const) {
		const result = await db.deleteFrom(table).where("expiresAt", "<", value).executeTakeFirst();
		deleted += Number(result?.numDeletedRows ?? 0);
	}
	return deleted;
}
