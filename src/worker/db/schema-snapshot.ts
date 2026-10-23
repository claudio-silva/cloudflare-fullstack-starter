/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Kysely } from "kysely";
import type { SchemaSnapshot, SchemaChange } from "../../shared/migration-types";

export type { SchemaSnapshot, SchemaTable, SchemaColumn, SchemaChange } from "../../shared/migration-types";

/** Bookkeeping that belongs to the tooling, not to the application schema. */
const INTERNAL_TABLES = ["migration_journal", "d1_migrations"];
const INTERNAL_PREFIXES = ["kysely_", "sqlite_", "_cf_"];

/**
 * A portable description of the schema, used for two things: proving that the
 * baseline and the incremental path converge (the cross-database tests), and
 * catching a migration that destroys structure while claiming to be `expand`.
 *
 * It leans on Kysely's own introspection rather than per-engine
 * `information_schema` queries, which is what makes a SQLite snapshot
 * comparable to a PostgreSQL one.
 */
export async function schemaSnapshot(db: Kysely<any>): Promise<SchemaSnapshot> {
	const tables = await db.introspection.getTables();
	return tables
		.filter((t) => !INTERNAL_PREFIXES.some((p) => t.name.startsWith(p)) && !INTERNAL_TABLES.includes(t.name))
		.map((t) => ({
			table: t.name,
			columns: t.columns
				.map((c) => ({ name: c.name, nullable: c.isNullable, hasDefault: c.hasDefaultValue }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * What changed between two snapshots, and which of it is incompatible with the
 * previous release still serving requests.
 *
 * Destructive means more than "removes something": a new `NOT NULL` column
 * without a default is just as fatal, because the old code does not know to
 * write it. Structurally it is indistinguishable from a removal, and this is
 * the check that catches it.
 */
export function diffSnapshots(before: SchemaSnapshot, after: SchemaSnapshot): SchemaChange[] {
	const changes: SchemaChange[] = [];
	const beforeTables = new Map(before.map((t) => [t.table, t]));
	const afterTables = new Map(after.map((t) => [t.table, t]));

	for (const table of afterTables.keys()) {
		if (!beforeTables.has(table)) changes.push({ kind: "table-added", table, destructive: false });
	}
	for (const table of beforeTables.keys()) {
		if (!afterTables.has(table)) changes.push({ kind: "table-removed", table, destructive: true });
	}
	for (const [name, afterTable] of afterTables) {
		const beforeTable = beforeTables.get(name);
		if (!beforeTable) continue;
		const beforeCols = new Map(beforeTable.columns.map((c) => [c.name, c]));
		const afterCols = new Map(afterTable.columns.map((c) => [c.name, c]));
		for (const [col, def] of afterCols) {
			if (beforeCols.has(col)) continue;
			changes.push({
				kind: def.nullable || def.hasDefault ? "column-added" : "column-required",
				table: name,
				column: col,
				destructive: !def.nullable && !def.hasDefault,
			});
		}
		for (const col of beforeCols.keys()) {
			if (!afterCols.has(col)) {
				changes.push({ kind: "column-removed", table: name, column: col, destructive: true });
			}
		}
	}
	return changes;
}

export function describeChange(change: SchemaChange): string {
	const target = change.column ? `${change.table}.${change.column}` : change.table;
	switch (change.kind) {
		case "table-added":
			return `+ table ${target}`;
		case "table-removed":
			return `- table ${target}`;
		case "column-added":
			return `+ column ${target}`;
		case "column-removed":
			return `- column ${target}`;
		case "column-required":
			return `! column ${target} is NOT NULL with no default`;
	}
}
