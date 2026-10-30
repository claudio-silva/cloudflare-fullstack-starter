import { sql, type Kysely } from "kysely";
import { columnTypes } from "../columns";
import { ensureColumn, ensureIndex, ensureTable } from "../ensure";
import type { MigrationFactory } from "../types";

/**
 * Makes `login_events` a permanent per-user history, and keeps totals apart
 * from it.
 *
 * - `login_events` gains the sign-in `method` ("password", "google", …), the
 *   `session_id` a row belongs to, the `actor_id` of whoever caused it when that
 *   is not the user (an admin revoking or deleting), and `duration_seconds` on
 *   the row that ends a session. An index on (user_id, created_at) serves every
 *   per-user query.
 * - `user_stats` holds one row of running totals per user, updated as events
 *   happen, so the totals survive if old log rows are ever deleted.
 * - `users.disabled` blocks sign-in, independently of `emailVerified`.
 *
 * All additive: nullable columns or columns with a default, a new table, an
 * index. The totals are backfilled from the log as it is; durations were not
 * recorded before, so time in session starts at zero.
 */
export const userStatsAndLogDetail: MigrationFactory = (kind) => {
	const t = columnTypes(kind);
	return {
		compatibility: "expand",
		async up(db: Kysely<unknown>) {
			await ensureColumn(db, kind, "users", "disabled", t.boolean, (c) => c.notNull().defaultTo(false));

			await ensureColumn(db, kind, "login_events", "method", "varchar(16)");
			await ensureColumn(db, kind, "login_events", "session_id", t.id);
			await ensureColumn(db, kind, "login_events", "actor_id", t.id);
			await ensureColumn(db, kind, "login_events", "duration_seconds", "integer");
			await ensureIndex(db, kind, "login_events", "idx_login_events_user", ["user_id", "created_at"]);

			await ensureTable(db, kind, "user_stats", (table) =>
				table
					.addColumn("user_id", t.id, (c) => c.primaryKey())
					.addColumn("sign_ins", "integer", (c) => c.notNull().defaultTo(0))
					.addColumn("failed_sign_ins", "integer", (c) => c.notNull().defaultTo(0))
					.addColumn("session_seconds", "integer", (c) => c.notNull().defaultTo(0))
					.addColumn("last_sign_in_at", t.timestamp),
			);

			// Backfill, for users who have no row yet (so a re-run adds nothing twice).
			const success = kind === "postgres" ? sql`true` : sql`1`;
			await sql`
				insert into user_stats (user_id, sign_ins, failed_sign_ins, session_seconds, last_sign_in_at)
				select user_id,
					sum(case when success = ${success} and (event is null or event = 'sign-in') then 1 else 0 end),
					sum(case when success = ${success} then 0 else 1 end),
					0,
					max(case when success = ${success} and (event is null or event = 'sign-in') then created_at end)
				from login_events
				where user_id is not null and user_id not in (select user_id from user_stats)
				group by user_id
			`.execute(db);
		},
	};
};
