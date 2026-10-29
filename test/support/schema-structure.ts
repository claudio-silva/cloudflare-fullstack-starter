import { sql, type Kysely } from "kysely";
import type { DatabaseKind } from "../../src/worker/db";
import { schemaSnapshot } from "./schema-snapshot";

type AnyDb = Kysely<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type StructureColumn = { name: string; type: string; nullable: boolean; default: string | null };
export type StructureTable = {
	table: string;
	columns: StructureColumn[];
	/** One normalised definition per index: name, uniqueness, columns and any partial predicate. */
	indexes: string[];
	/** One normalised definition per foreign key: columns, parent, parent columns and delete rule. */
	foreignKeys: string[];
};

/**
 * Everything `schemaSnapshot` leaves out because it cannot be compared across
 * engines: column types, default values, indexes and foreign keys, in each
 * engine's own terms. Only two databases of the same kind are comparable, which
 * is all the drift test needs (baseline vs incremental on one engine).
 */
export async function schemaStructure(db: AnyDb, kind: DatabaseKind): Promise<StructureTable[]> {
	const tables = (await schemaSnapshot(db)).map((t) => t.table);
	const read = kind === "sqlite" ? sqliteTable : kind === "postgres" ? postgresTable : mysqlTable;
	const result: StructureTable[] = [];
	for (const table of tables) {
		const t = await read(db, table);
		result.push({
			table,
			columns: t.columns.sort((a, b) => a.name.localeCompare(b.name)),
			indexes: t.indexes.sort(),
			foreignKeys: t.foreignKeys.sort(),
		});
	}
	return result;
}

type Parts = Omit<StructureTable, "table">;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

// D1 accepts pragma table functions with literal arguments only.
async function sqliteTable(db: AnyDb, table: string): Promise<Parts> {
	const t = sql.lit(table);
	const cols = (await sql<{ name: string; type: string; nn: number; dflt: unknown; pk: number }>`
		select name, type, "notnull" as nn, dflt_value as dflt, pk from pragma_table_info(${t})`.execute(db)).rows;
	const list = (await sql<{ name: string; uq: number; origin: string }>`
		select name, "unique" as uq, origin from pragma_index_list(${t})`.execute(db)).rows;
	const indexes: string[] = [];
	for (const index of list) {
		const columns = (await sql<{ name: string }>`select name from pragma_index_info(${sql.lit(index.name)}) order by seqno`.execute(db)).rows.map((r) => r.name);
		const ddl = (await sql<{ sql: string | null }>`select sql from sqlite_master where type = 'index' and name = ${index.name}`.execute(db)).rows[0]?.sql;
		const where = ddl?.match(/\swhere\s([\s\S]+)$/i)?.[1].trim();
		// Indexes SQLite creates for PRIMARY KEY / UNIQUE constraints are numbered by declaration order: name them by origin.
		const name = index.origin === "c" ? index.name : `(${index.origin})`;
		indexes.push(`${name}${index.uq ? " unique" : ""} (${columns.join(", ")})${where ? ` where ${where}` : ""}`);
	}
	const fks = (await sql<{ id: number; seq: number; parent: string; from: string; to: string | null; del: string }>`
		select id, seq, "table" as parent, "from", "to", on_delete as del from pragma_foreign_key_list(${t})`.execute(db)).rows;
	const byId = new Map<number, typeof fks>();
	for (const fk of fks) byId.set(fk.id, [...(byId.get(fk.id) ?? []), fk]);
	const foreignKeys = [...byId.values()].map((parts) => {
		parts.sort((a, b) => a.seq - b.seq);
		return `(${parts.map((p) => p.from).join(", ")}) -> ${parts[0].parent}(${parts.map((p) => p.to ?? "").join(", ")}) on delete ${parts[0].del.toLowerCase()}`;
	});
	return {
		columns: cols.map((c) => ({ name: c.name, type: c.type.toLowerCase(), nullable: !c.nn && !c.pk, default: str(c.dflt) })),
		indexes,
		foreignKeys,
	};
}

async function postgresTable(db: AnyDb, table: string): Promise<Parts> {
	const cols = (await sql<{ name: string; type: string; len: number | null; nullable: string; dflt: unknown }>`
		select column_name as name, data_type as type, character_maximum_length as len, is_nullable as nullable, column_default as dflt
		from information_schema.columns where table_schema = 'public' and table_name = ${table}`.execute(db)).rows;
	const indexes = (await sql<{ def: string }>`
		select indexdef as def from pg_indexes where schemaname = 'public' and tablename = ${table}`.execute(db)).rows;
	const fks = (await sql<{ def: string }>`
		select pg_get_constraintdef(k.oid) as def from pg_constraint k join pg_class c on c.oid = k.conrelid
		where k.contype = 'f' and k.connamespace = 'public'::regnamespace and c.relname = ${table}`.execute(db)).rows;
	return {
		columns: cols.map((c) => ({ name: c.name, type: c.len ? `${c.type}(${c.len})` : c.type, nullable: c.nullable === "YES", default: str(c.dflt) })),
		indexes: indexes.map((i) => i.def.replace(/\bpublic\./g, "")),
		foreignKeys: fks.map((f) => f.def),
	};
}

async function mysqlTable(db: AnyDb, table: string): Promise<Parts> {
	const cols = (await sql<{ name: string; type: string; nullable: string; dflt: unknown }>`
		select column_name as name, column_type as type, is_nullable as nullable, column_default as dflt
		from information_schema.columns where table_schema = database() and table_name = ${table}`.execute(db)).rows;
	const stats = (await sql<{ name: string; nonUnique: number | string; col: string; seq: number; sub: number | null }>`
		select index_name as name, non_unique as nonUnique, column_name as col, seq_in_index as seq, sub_part as sub
		from information_schema.statistics where table_schema = database() and table_name = ${table}`.execute(db)).rows;
	const byIndex = new Map<string, typeof stats>();
	for (const s of stats) byIndex.set(s.name, [...(byIndex.get(s.name) ?? []), s]);
	const indexes = [...byIndex.entries()].map(([name, parts]) => {
		parts.sort((a, b) => Number(a.seq) - Number(b.seq));
		const unique = Number(parts[0].nonUnique) === 0;
		return `${name}${unique ? " unique" : ""} (${parts.map((p) => (p.sub ? `${p.col}(${p.sub})` : p.col)).join(", ")})`;
	});
	const fks = (await sql<{ name: string; col: string; parent: string; ref: string; seq: number; del: string }>`
		select k.constraint_name as name, k.column_name as col, k.referenced_table_name as parent, k.referenced_column_name as ref,
			k.ordinal_position as seq, r.delete_rule as del
		from information_schema.key_column_usage k
		join information_schema.referential_constraints r on r.constraint_schema = k.constraint_schema and r.constraint_name = k.constraint_name
		where k.table_schema = database() and k.table_name = ${table} and k.referenced_table_name is not null`.execute(db)).rows;
	// Foreign keys are compared without their names: MySQL numbers unnamed ones by declaration order.
	const byFk = new Map<string, typeof fks>();
	for (const f of fks) byFk.set(f.name, [...(byFk.get(f.name) ?? []), f]);
	const foreignKeys = [...byFk.values()].map((parts) => {
		parts.sort((a, b) => Number(a.seq) - Number(b.seq));
		return `(${parts.map((p) => p.col).join(", ")}) -> ${parts[0].parent}(${parts.map((p) => p.ref).join(", ")}) on delete ${parts[0].del.toLowerCase()}`;
	});
	return {
		columns: cols.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable === "YES", default: str(c.dflt) })),
		indexes,
		foreignKeys,
	};
}
