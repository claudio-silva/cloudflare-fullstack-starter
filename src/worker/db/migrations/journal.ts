/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, type Kysely, type KyselyPlugin, type PluginTransformQueryArgs, type PluginTransformResultArgs } from "kysely";
import type { DatabaseKind } from "../index";
import type { JournalEntry } from "../../../shared/migration-types";

export type { JournalEntry };

/**
 * A record of what each migration run actually did.
 *
 * Why it exists: on MySQL (and SQLite/D1) a migration that fails halfway leaves
 * the schema in a state nobody wrote down. Kysely wraps *all* pending
 * migrations in one transaction only where the dialect supports transactional
 * DDL — PostgreSQL and MSSQL do, MySQL and SQLite do not. So on PostgreSQL a
 * failure rolls everything back and there is nothing to repair; everywhere else
 * you need to know how far it got before deciding how to recover.
 *
 * This table is bookkeeping, not a migration: it is created directly, like
 * Kysely's own `kysely_migration` table, because it has to exist before the
 * first migration runs.
 */
export const JOURNAL_TABLE = "migration_journal";

export async function ensureJournalTable(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable(JOURNAL_TABLE)
		.ifNotExists()
		.addColumn("id", "varchar(255)", (c) => c.primaryKey())
		.addColumn("migration_name", "varchar(255)", (c) => c.notNull())
		.addColumn("compatibility", "varchar(50)", (c) => c.notNull())
		.addColumn("status", "varchar(50)", (c) => c.notNull())
		.addColumn("statements_attempted", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("statements_completed", "integer", (c) => c.notNull().defaultTo(0))
		.addColumn("rolled_back", "boolean", (c) => c.notNull().defaultTo(false))
		.addColumn("error", "text")
		.addColumn("started_at", "varchar(255)", (c) => c.notNull())
		.addColumn("finished_at", "varchar(255)", (c) => c.notNull())
		.execute();
}

export async function recordJournal(db: Kysely<any>, entries: JournalEntry[]): Promise<void> {
	if (entries.length === 0) return;
	await db
		.insertInto(JOURNAL_TABLE)
		.values(entries.map((e) => ({ id: crypto.randomUUID(), ...e })))
		.execute();
}

export async function readJournal(db: Kysely<any>, limit = 20): Promise<JournalEntry[]> {
	const { rows } = await sql<JournalEntry>`
		select * from ${sql.table(JOURNAL_TABLE)} order by finished_at desc
	`.execute(db);
	return rows.slice(0, limit);
}

/**
 * Counts statements as they go past, so a failed run can say how far it got.
 *
 * A Kysely plugin sees every query the migrator sends: `transformQuery` fires
 * on the way out, `transformResult` on the way back. The gap between the two
 * counters is the statement that threw.
 */
export class StatementCounter implements KyselyPlugin {
	attempted = 0;
	completed = 0;

	transformQuery(args: PluginTransformQueryArgs) {
		this.attempted += 1;
		return args.node;
	}

	async transformResult(args: PluginTransformResultArgs) {
		this.completed += 1;
		return args.result;
	}

	reset(): void {
		this.attempted = 0;
		this.completed = 0;
	}
}

/** PostgreSQL and MSSQL roll a failed migration run back; MySQL and SQLite do not. */
export function rollsBackOnFailure(kind: DatabaseKind): boolean {
	return kind === "postgres";
}
