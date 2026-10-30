import type { Kysely } from "kysely";
import { ensureColumn } from "../ensure";
import type { MigrationFactory } from "../types";

/**
 * Tells sign-ins from sign-outs in `login_events`. Null means a sign-in, which
 * is what every row written before this migration is, so nothing to backfill.
 * Nullable, so the running version (which does not write it) keeps working.
 */
export const loginEventKind: MigrationFactory = (kind) => ({
	compatibility: "expand",
	async up(db: Kysely<unknown>) {
		await ensureColumn(db, kind, "login_events", "event", "varchar(16)");
	},
});
