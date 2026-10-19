/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, type Kysely } from "kysely";
import type { DatabaseKind } from "./index";

/**
 * Database-agnostic logical backup and restore (D1/SQLite, PostgreSQL, MySQL).
 *
 * The CLI drives these functions through `/api/cli/backup/*` and `/api/cli/restore/*`: it pages
 * through every data table, writes the rows to a file, and later replays them. Schema is not part
 * of a backup: it is owned by the migrations, so a backup records which migrations were applied and
 * a restore only runs against a database at the same schema version.
 */
type AnyDb = Kysely<any>;

export type BackupColumn = { name: string; type: string };
export type BackupTable = {
	name: string;
	columns: BackupColumn[];
	primaryKey: string[];
	/** Other tables this one has foreign keys to (self references excluded). */
	references: string[];
};

/** Tables that belong to tooling, not to the application's data. */
const INTERNAL_TABLE = /^(kysely_|sqlite_|_cf_|d1_migrations$)/;

type ColumnRow = { tbl: string; name: string; type: string; pos: number };
type KeyRow = { tbl: string; name: string; pos: number };
type ReferenceRow = { tbl: string; parent: string };

async function readSchemaRows(db: AnyDb, kind: DatabaseKind): Promise<{ columns: ColumnRow[]; keys: KeyRow[]; references: ReferenceRow[] }> {
	if (kind === "sqlite") {
		const { rows: tables } = await sql<{ name: string }>`select name from sqlite_master where type = 'table' order by name`.execute(db);
		const names = tables.map((t) => t.name).filter((n) => !INTERNAL_TABLE.test(n));
		if (names.length === 0) return { columns: [], keys: [], references: [] };
		// D1 accepts pragma table functions with literal arguments only, and at most 5 terms in a
		// compound select: query the tables five at a time.
		const info: Array<{ tbl: string; name: string; type: string; pk: number; cid: number }> = [];
		const fks: ReferenceRow[] = [];
		for (let i = 0; i < names.length; i += 5) {
			const group = names.slice(i, i + 5);
			const union = (select: (name: string) => ReturnType<typeof sql>) => sql.join(group.map(select), sql` union all `);
			info.push(
				...(await sql<(typeof info)[number]>`${union((n) => sql`select ${sql.lit(n)} as tbl, name, type, pk, cid from pragma_table_info(${sql.lit(n)})`)}`.execute(db)).rows,
			);
			fks.push(
				...(await sql<ReferenceRow>`${union((n) => sql`select ${sql.lit(n)} as tbl, "table" as parent from pragma_foreign_key_list(${sql.lit(n)})`)}`.execute(db)).rows,
			);
		}
		return {
			columns: info.map((r) => ({ tbl: r.tbl, name: r.name, type: r.type, pos: r.cid })),
			keys: info.filter((r) => r.pk > 0).map((r) => ({ tbl: r.tbl, name: r.name, pos: r.pk })),
			references: fks,
		};
	}

	if (kind === "postgres") {
		const columns = await sql<ColumnRow>`
			select c.table_name as tbl, c.column_name as name, c.data_type as type, c.ordinal_position as pos
			from information_schema.columns c
			join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
			where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`.execute(db);
		const keys = await sql<KeyRow>`
			select c.relname as tbl, a.attname as name, array_position(i.indkey::int2[], a.attnum) as pos
			from pg_index i
			join pg_class c on c.oid = i.indrelid
			join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
			where i.indisprimary and c.relnamespace = 'public'::regnamespace`.execute(db);
		const references = await sql<ReferenceRow>`
			select c.relname as tbl, p.relname as parent
			from pg_constraint k
			join pg_class c on c.oid = k.conrelid
			join pg_class p on p.oid = k.confrelid
			where k.contype = 'f' and k.connamespace = 'public'::regnamespace`.execute(db);
		return { columns: columns.rows, keys: keys.rows, references: references.rows };
	}

	const columns = await sql<ColumnRow>`
		select c.table_name as tbl, c.column_name as name, c.data_type as type, c.ordinal_position as pos
		from information_schema.columns c
		join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
		where c.table_schema = database() and t.table_type = 'BASE TABLE'`.execute(db);
	const keys = await sql<KeyRow>`
		select table_name as tbl, column_name as name, ordinal_position as pos
		from information_schema.key_column_usage
		where table_schema = database() and constraint_name = 'PRIMARY'`.execute(db);
	const references = await sql<ReferenceRow>`
		select table_name as tbl, referenced_table_name as parent
		from information_schema.key_column_usage
		where table_schema = database() and referenced_table_name is not null`.execute(db);
	return { columns: columns.rows, keys: keys.rows, references: references.rows };
}

/** Parents before children, so rows can be inserted in order and deleted in reverse. */
function sortByDependency(tables: BackupTable[]): BackupTable[] {
	const remaining = new Map(tables.map((t) => [t.name, t]));
	const ordered: BackupTable[] = [];
	while (remaining.size > 0) {
		const ready = [...remaining.values()].filter((t) => t.references.every((p) => !remaining.has(p)));
		// A foreign key cycle cannot be ordered: fall back to name order for what is left.
		const batch = ready.length > 0 ? ready : [...remaining.values()];
		for (const t of batch.sort((a, b) => a.name.localeCompare(b.name))) {
			ordered.push(t);
			remaining.delete(t.name);
		}
	}
	return ordered;
}

/** The application's data tables with their columns and keys, in dependency order. */
export async function describeSchema(db: AnyDb, kind: DatabaseKind): Promise<BackupTable[]> {
	const { columns, keys, references } = await readSchemaRows(db, kind);
	const tables = new Map<string, BackupTable>();
	for (const c of [...columns].sort((a, b) => Number(a.pos) - Number(b.pos))) {
		if (INTERNAL_TABLE.test(c.tbl)) continue;
		const table = tables.get(c.tbl) ?? { name: c.tbl, columns: [], primaryKey: [], references: [] };
		table.columns.push({ name: c.name, type: String(c.type ?? "") });
		tables.set(c.tbl, table);
	}
	for (const k of [...keys].sort((a, b) => Number(a.pos) - Number(b.pos))) tables.get(k.tbl)?.primaryKey.push(k.name);
	for (const r of references) {
		const table = tables.get(r.tbl);
		if (table && r.parent !== r.tbl && tables.has(r.parent) && !table.references.includes(r.parent)) table.references.push(r.parent);
	}
	return sortByDependency([...tables.values()]);
}

/** Names of the migrations applied to the database (empty before the first migration). */
export async function appliedMigrations(db: AnyDb): Promise<string[]> {
	try {
		const { rows } = await sql<{ name: string }>`select name from kysely_migration`.execute(db);
		return rows.map((r) => r.name).sort();
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Value encoding. Rows travel as JSON, so values JSON cannot represent are tagged objects.
// ---------------------------------------------------------------------------

export type EncodedValue = string | number | boolean | null | { $date: string } | { $bigint: string } | { $bytes: string } | { $json: unknown };
export type EncodedRow = Record<string, EncodedValue>;

const toBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
};
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function encodeValue(value: unknown, type: string): EncodedValue {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return { $date: value.toISOString() };
	if (typeof value === "bigint") return { $bigint: value.toString() };
	if (value instanceof ArrayBuffer) return { $bytes: toBase64(new Uint8Array(value)) };
	if (ArrayBuffer.isView(value)) return { $bytes: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
	// D1 returns BLOB columns as arrays of byte values.
	if (Array.isArray(value) && /blob/i.test(type)) return { $bytes: toBase64(Uint8Array.from(value as number[])) };
	if (typeof value === "object") return { $json: value };
	return value as string | number | boolean;
}

function decodeValue(value: EncodedValue, type: string, kind: DatabaseKind): unknown {
	if (value === null || typeof value !== "object") {
		if (kind === "sqlite" && typeof value === "boolean") return value ? 1 : 0;
		// Backups from another database may hold ISO strings where this one wants a Date.
		if (kind !== "sqlite" && typeof value === "string" && /timestamp|datetime/i.test(type)) {
			const date = new Date(value);
			if (!Number.isNaN(date.getTime())) return date;
		}
		return value;
	}
	if ("$date" in value) return kind === "sqlite" ? value.$date : new Date(value.$date);
	if ("$bigint" in value) return value.$bigint;
	if ("$bytes" in value) {
		const bytes = fromBase64(value.$bytes);
		if (kind === "sqlite") return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		// Node drivers (pg, mysql2) want a Buffer; Workers with nodejs_compat provide one too.
		const NodeBuffer = (globalThis as { Buffer?: { from(bytes: Uint8Array): unknown } }).Buffer;
		return NodeBuffer ? NodeBuffer.from(bytes) : bytes;
	}
	return JSON.stringify(value.$json);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** One page of rows, ordered by primary key so paging is stable. */
export async function exportRows(db: AnyDb, table: BackupTable, offset: number, limit: number): Promise<EncodedRow[]> {
	let query = db.selectFrom(table.name).selectAll();
	for (const key of table.primaryKey) query = query.orderBy(key);
	const rows = (await query.limit(limit).offset(offset).execute()) as Record<string, unknown>[];
	const types = new Map(table.columns.map((c) => [c.name, c.type]));
	return rows.map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, encodeValue(value, types.get(name) ?? "")])));
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** Statements one request may issue (D1 limits queries per Worker invocation: 50 on the free plan). */
const STATEMENTS_PER_REQUEST = 30;
const MAX_ROWS_PER_REQUEST = 1000;

function maxBoundParameters(kind: DatabaseKind): number {
	return kind === "sqlite" ? 100 : 60_000; // D1 allows 100 bound parameters per statement
}

function rowsPerStatement(kind: DatabaseKind, columnCount: number): number {
	return Math.max(1, Math.floor(maxBoundParameters(kind) / Math.max(1, columnCount)));
}

/** How many rows the client may send in one restore request for a table. */
export function restoreChunkRows(kind: DatabaseKind, table: BackupTable): number {
	return Math.min(MAX_ROWS_PER_REQUEST, STATEMENTS_PER_REQUEST * rowsPerStatement(kind, table.columns.length));
}

export async function clearTable(db: AnyDb, table: BackupTable): Promise<void> {
	await db.deleteFrom(table.name).execute();
}

export async function importRows(db: AnyDb, kind: DatabaseKind, table: BackupTable, rows: EncodedRow[]): Promise<void> {
	if (rows.length > restoreChunkRows(kind, table)) throw new Error(`Too many rows for one request (max ${restoreChunkRows(kind, table)} for ${table.name})`);
	const types = new Map(table.columns.map((c) => [c.name, c.type]));
	const perStatement = rowsPerStatement(kind, table.columns.length);
	const decoded = rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([name, value]) => {
				if (!types.has(name)) throw new Error(`Column ${table.name}.${name} does not exist in this database`);
				return [name, decodeValue(value, types.get(name)!, kind)];
			}),
		),
	);
	for (let i = 0; i < decoded.length; i += perStatement) {
		await db.insertInto(table.name).values(decoded.slice(i, i + perStatement)).execute();
	}
}

/**
 * After a table has been restored: returns its row count (to verify the restore) and, on PostgreSQL,
 * moves serial/identity sequences past the restored ids so new inserts do not collide.
 */
export async function finishTable(db: AnyDb, kind: DatabaseKind, table: BackupTable): Promise<{ rowCount: number }> {
	if (kind === "postgres") {
		for (const column of table.columns.filter((c) => /int/i.test(c.type))) {
			const { rows } = await sql<{ seq: string | null }>`select pg_get_serial_sequence(${`"${table.name}"`}, ${column.name}) as seq`.execute(db);
			const seq = rows[0]?.seq;
			if (!seq) continue;
			await sql`select setval(${seq}::regclass, coalesce(max(${sql.ref(column.name)}), 1), max(${sql.ref(column.name)}) is not null) from ${sql.table(table.name)}`.execute(db);
		}
	}
	const { rows } = await sql<{ n: number | string | bigint }>`select count(*) as n from ${sql.table(table.name)}`.execute(db);
	return { rowCount: Number(rows[0]?.n ?? 0) };
}
