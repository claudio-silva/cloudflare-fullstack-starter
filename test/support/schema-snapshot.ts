import type { Kysely } from "kysely";

/** Dialect-neutral structural snapshot (tables, columns, nullability) via Kysely introspection. */
export async function schemaSnapshot(db: Kysely<any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
	const tables = await db.introspection.getTables();
	return tables
		.filter((t) => !t.name.startsWith("kysely_") && !t.name.startsWith("sqlite_") && !t.name.startsWith("_cf_") && t.name !== "d1_migrations")
		.map((t) => ({
			table: t.name,
			columns: t.columns
				.map((c) => ({ name: c.name, nullable: c.isNullable, hasDefault: c.hasDefaultValue }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.table.localeCompare(b.table));
}
