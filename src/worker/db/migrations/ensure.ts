/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, type Kysely, type ColumnDataType, type ColumnDefinitionBuilder, type Expression } from "kysely";
import type { DatabaseKind } from "../index";

/**
 * Idempotent schema operations: "make sure this exists", not "create this".
 *
 * Why they matter. When a migration fails halfway on MySQL or SQLite there is
 * no rollback, so the schema keeps whatever the earlier statements did. If
 * every statement is idempotent, recovery is simply running the migration
 * again: the parts that succeeded are skipped and the rest completes. Without
 * that, re-running fails on the first "column already exists" and you are
 * repairing the schema by hand under pressure.
 *
 * SQLite and PostgreSQL support `IF NOT EXISTS` on most of this; MySQL does
 * not, so these helpers ask `information_schema` first. One API, same
 * behaviour on all three.
 */

type ColumnType = ColumnDataType | Expression<unknown>;

async function tableExists(db: Kysely<any>, kind: DatabaseKind, table: string): Promise<boolean> {
	if (kind === "sqlite") {
		const { rows } = await sql<{ name: string }>`
			select name from sqlite_master where type = 'table' and name = ${table}
		`.execute(db);
		return rows.length > 0;
	}
	const { rows } = await sql<{ c: number }>`
		select count(*) as c from information_schema.tables
		where table_schema = ${kind === "mysql" ? sql`database()` : sql`current_schema()`}
		  and table_name = ${table}
	`.execute(db);
	return Number(rows[0]?.c ?? 0) > 0;
}

async function columnExists(
	db: Kysely<any>,
	kind: DatabaseKind,
	table: string,
	column: string,
): Promise<boolean> {
	if (kind === "sqlite") {
		const { rows } = await sql<{ name: string }>`
			select name from pragma_table_info(${table})
		`.execute(db);
		return rows.some((r) => r.name === column);
	}
	const { rows } = await sql<{ c: number }>`
		select count(*) as c from information_schema.columns
		where table_schema = ${kind === "mysql" ? sql`database()` : sql`current_schema()`}
		  and table_name = ${table} and column_name = ${column}
	`.execute(db);
	return Number(rows[0]?.c ?? 0) > 0;
}

async function indexExists(db: Kysely<any>, kind: DatabaseKind, table: string, index: string): Promise<boolean> {
	if (kind === "sqlite") {
		const { rows } = await sql<{ name: string }>`
			select name from sqlite_master where type = 'index' and name = ${index}
		`.execute(db);
		return rows.length > 0;
	}
	if (kind === "mysql") {
		const { rows } = await sql<{ c: number }>`
			select count(*) as c from information_schema.statistics
			where table_schema = database() and table_name = ${table} and index_name = ${index}
		`.execute(db);
		return Number(rows[0]?.c ?? 0) > 0;
	}
	const { rows } = await sql<{ c: number }>`
		select count(*) as c from pg_indexes where schemaname = current_schema() and indexname = ${index}
	`.execute(db);
	return Number(rows[0]?.c ?? 0) > 0;
}

/**
 * Add a column unless it is already there.
 *
 * Keep it nullable or give it a default: a `NOT NULL` column with no default
 * breaks the version still running beside the migration, which does not know
 * to write it. That makes the migration `breaking`, not `expand`.
 */
export async function ensureColumn(
	db: Kysely<any>,
	kind: DatabaseKind,
	table: string,
	column: string,
	type: ColumnType,
	build?: (col: ColumnDefinitionBuilder) => ColumnDefinitionBuilder,
): Promise<boolean> {
	if (await columnExists(db, kind, table, column)) return false;
	await db.schema
		.alterTable(table)
		.addColumn(column, type as ColumnDataType, (c) => (build ? build(c) : c))
		.execute();
	return true;
}

/** Create an index unless one with that name already exists. */
export async function ensureIndex(
	db: Kysely<any>,
	kind: DatabaseKind,
	table: string,
	index: string,
	columns: string[],
	options?: { unique?: boolean },
): Promise<boolean> {
	if (await indexExists(db, kind, table, index)) return false;
	let builder = db.schema.createIndex(index).on(table).columns(columns);
	if (options?.unique) builder = builder.unique();
	await builder.execute();
	return true;
}

/** The builder `db.schema.createTable(name)` hands back, so callbacks stay typed. */
type CreateTable = ReturnType<Kysely<any>["schema"]["createTable"]>;

/** Run `build` to create the table unless it already exists. */
export async function ensureTable(
	db: Kysely<any>,
	kind: DatabaseKind,
	table: string,
	build: (b: CreateTable) => CreateTable,
): Promise<boolean> {
	if (await tableExists(db, kind, table)) return false;
	await build(db.schema.createTable(table)).execute();
	return true;
}

/** Drop a column only if present — the `contract` counterpart of {@link ensureColumn}. */
export async function ensureNoColumn(
	db: Kysely<any>,
	kind: DatabaseKind,
	table: string,
	column: string,
): Promise<boolean> {
	if (!(await columnExists(db, kind, table, column))) return false;
	await db.schema.alterTable(table).dropColumn(column).execute();
	return true;
}
