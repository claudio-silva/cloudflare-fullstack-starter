import { sql, type Expression } from "kysely";
import type { DatabaseKind } from "../index";

/**
 * Column types that work on SQLite (D1), PostgreSQL and MySQL.
 * Rules: ids/emails/tokens are `varchar(255)` (MySQL cannot index unbounded text),
 * flags are `boolean`, instants are real datetimes (never epoch integers: Better Auth
 * sends Date/boolean values on PostgreSQL and MySQL).
 */
export function columnTypes(kind: DatabaseKind) {
	return {
		id: "varchar(255)" as const,
		short: "varchar(255)" as const,
		role: "varchar(50)" as const,
		text: "text" as const,
		boolean: "boolean" as const,
		/** MySQL has no `timestamptz`; `datetime(3)` keeps millisecond precision. */
		timestamp: (kind === "mysql" ? sql`datetime(3)` : "timestamptz") as "timestamptz" | Expression<unknown>,
	};
}
export type ColumnTypes = ReturnType<typeof columnTypes>;
