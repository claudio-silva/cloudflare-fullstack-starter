import type { Kysely } from "kysely";
import { columnTypes } from "../columns";
import { ensureIndex, ensureTable } from "../ensure";
import type { MigrationFactory } from "../types";

/**
 * Sign-in attempts, successful and failed.
 *
 * Who signed in, from where and when is the first question anyone asks about a
 * deployed app — for usage, and for noticing a password being guessed at. The
 * `sessions` table cannot answer it: it only holds sessions that currently
 * exist, so it forgets every expired login and never saw the failures.
 *
 * `ip` is personal data. `AUTH_LOG_RETENTION_DAYS` (default 90) prunes the
 * table on a schedule; see `src/worker/scheduled.ts`.
 */
export const loginEvents: MigrationFactory = (kind) => {
	const t = columnTypes(kind);
	return {
		compatibility: "expand",
		async up(db: Kysely<unknown>) {
			// Idempotent so a half-applied run on MySQL or SQLite can simply be re-run.
			await ensureTable(db, kind, "login_events", (table) =>
				table
					.addColumn("id", t.id, (c) => c.primaryKey())
					// Null for a failed attempt on an address that has no account.
					.addColumn("user_id", t.id)
					.addColumn("email", t.short, (c) => c.notNull())
					.addColumn("success", t.boolean, (c) => c.notNull())
					.addColumn("ip", t.short)
					.addColumn("user_agent", t.text)
					// Cloudflare's two-letter country for the request, when known.
					.addColumn("country", "varchar(2)")
					.addColumn("created_at", t.timestamp, (c) => c.notNull()),
			);
			await ensureIndex(db, kind, "login_events", "idx_login_events_created_at", ["created_at"]);
			await ensureIndex(db, kind, "login_events", "idx_login_events_email", ["email"]);
		},
	};
};
