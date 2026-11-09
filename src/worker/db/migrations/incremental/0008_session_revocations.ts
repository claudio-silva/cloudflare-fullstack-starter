import type { Kysely } from "kysely";
import { columnTypes } from "../columns";
import { ensureIndex, ensureTable } from "../ensure";
import type { MigrationFactory } from "../types";

/**
 * Markers for the sessions that disabling a user ended.
 *
 * Disabling deletes the user's sessions, after which the server cannot tell
 * "disabled" from "expired". Each ended session's token is kept here until it
 * would have expired, so a request still carrying it is answered 403
 * `account_disabled` instead of a bare 401. Read only when a request has no
 * live session (lib/session-revocations.ts). A new table: purely additive.
 */
export const sessionRevocations: MigrationFactory = (kind) => {
	const t = columnTypes(kind);
	return {
		compatibility: "expand",
		async up(db: Kysely<unknown>) {
			await ensureTable(db, kind, "session_revocations", (table) =>
				table
					.addColumn("token", t.id, (c) => c.primaryKey())
					.addColumn("user_id", t.id, (c) => c.notNull())
					.addColumn("reason", "varchar(32)", (c) => c.notNull())
					.addColumn("expires_at", t.timestamp, (c) => c.notNull())
					.addColumn("created_at", t.timestamp, (c) => c.notNull()),
			);
			await ensureIndex(db, kind, "session_revocations", "idx_session_revocations_user", ["user_id"]);
		},
	};
};
