/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, type Kysely } from "kysely";
import { Migrator } from "kysely/migration";
import type { DatabaseKind } from "../index";
import { createBaseline, createMigrations } from "./index";
import {
	ensureJournalTable,
	recordJournal,
	rollsBackOnFailure,
	StatementCounter,
	type JournalEntry,
} from "./journal";
import type { MigrationCompatibility, PendingMigration } from "../../../shared/migration-types";

export type { PendingMigration };

export type MigrateOptions = {
	kind: DatabaseKind;
	/** Run the incremental path even on an empty database (tests use this to prove both paths converge). */
	forceIncremental?: boolean;
	/** Limit the run to migrations of these kinds. Omitted means all of them. */
	only?: MigrationCompatibility[];
};

export type MigrateResult = {
	mode: "baseline" | "adopted-legacy" | "incremental";
	applied: string[];
};

function newMigrator(db: Kysely<any>, kind: DatabaseKind, only?: MigrationCompatibility[]) {
	return new Migrator({
		db,
		provider: {
			getMigrations: async () => {
				const all = createMigrations(kind);
				if (!only) return all;
				return Object.fromEntries(
					Object.entries(all).filter(([, m]) => only.includes(m.compatibility ?? "expand")),
				);
			},
		},
	});
}

/** An empty-provider run creates the bookkeeping tables without applying anything. */
async function ensureBookkeeping(db: Kysely<any>) {
	await new Migrator({ db, provider: { getMigrations: async () => ({}) } }).migrateToLatest();
	await ensureJournalTable(db);
}

async function markApplied(db: Kysely<any>, names: string[]) {
	for (const name of names) {
		await db.insertInto("kysely_migration").values({ name, timestamp: new Date().toISOString() }).execute();
	}
}

/** Names recorded by the legacy `wrangler d1 migrations` tracker (`d1_migrations`), if present. */
async function legacyD1Names(db: Kysely<any>): Promise<string[]> {
	try {
		const { rows } = await sql<{ name: string }>`select name from d1_migrations`.execute(db);
		return rows.map((r) => r.name.replace(/\.sql$/, ""));
	} catch {
		return [];
	}
}

/** Pending migrations with their compatibility, so a deploy can order itself. */
export async function pendingMigrations(
	db: Kysely<any>,
	kind: DatabaseKind,
): Promise<PendingMigration[]> {
	await ensureBookkeeping(db);
	const defs = createMigrations(kind);
	const list = await newMigrator(db, kind).getMigrations();
	return list
		.filter((m) => m.executedAt === undefined)
		.map((m) => ({
			name: m.name,
			compatibility: defs[m.name]?.compatibility ?? "expand",
			safeSince: defs[m.name]?.safeSince,
		}));
}

/**
 * - Fresh database: run the baseline once, mark the migrations it squashes as applied.
 * - Legacy D1 database (tracked by `wrangler d1 migrations`): adopt the matching migrations as applied.
 * - Then run any pending incremental migrations.
 *
 * Every run is written to the journal, successful or not. On a dialect without
 * transactional DDL that record is the only account of how far a failed
 * migration got; see `journal.ts`.
 */
export async function migrateDatabase(db: Kysely<any>, opts: MigrateOptions): Promise<MigrateResult> {
	await ensureBookkeeping(db);
	const migrations = createMigrations(opts.kind);
	const nothingApplied = (await newMigrator(db, opts.kind).getMigrations()).every(
		(m) => m.executedAt === undefined,
	);

	let mode: MigrateResult["mode"] = "incremental";
	const applied: string[] = [];

	if (nothingApplied) {
		const legacy = await legacyD1Names(db);
		if (legacy.length > 0) {
			mode = "adopted-legacy";
			const matched = Object.entries(migrations)
				.filter(([, m]) => m.legacyName && legacy.includes(m.legacyName))
				.map(([n]) => n);
			if (matched.length === 0) {
				throw new Error(
					`Found a legacy d1_migrations table (${legacy.join(", ")}) but none of its names match a known migration. ` +
						"Give each equivalent migration a `legacyName` (see UPGRADING.md) before migrating.",
				);
			}
			await markApplied(db, matched);
		} else if (!opts.forceIncremental) {
			mode = "baseline";
			const baseline = createBaseline(opts.kind);
			await baseline.up(db);
			await markApplied(db, baseline.squashes);
			applied.push("baseline");
		}
	}

	const counter = new StatementCounter();
	const started = new Date().toISOString();
	const pendingBefore = (await newMigrator(db, opts.kind, opts.only).getMigrations())
		.filter((m) => m.executedAt === undefined)
		.map((m) => m.name);

	const { error, results } = await newMigrator(db.withPlugin(counter), opts.kind, opts.only).migrateToLatest();

	const succeeded = (results ?? []).filter((r) => r.status === "Success").map((r) => r.migrationName);
	applied.push(...succeeded);

	const finished = new Date().toISOString();
	const failedName = (results ?? []).find((r) => r.status === "Error")?.migrationName;
	const entries: JournalEntry[] = [];
	for (const name of pendingBefore) {
		const isFailed = name === failedName || (error && !succeeded.includes(name) && name === pendingBefore[succeeded.length]);
		if (!succeeded.includes(name) && !isFailed) continue; // never attempted
		entries.push({
			migration_name: name,
			compatibility: migrations[name]?.compatibility ?? "expand",
			status: succeeded.includes(name) ? "success" : "failed",
			statements_attempted: counter.attempted,
			statements_completed: counter.completed,
			rolled_back: Boolean(error) && rollsBackOnFailure(opts.kind),
			error: succeeded.includes(name) ? null : String(error ?? "unknown error").slice(0, 2000),
			started_at: started,
			finished_at: finished,
		});
	}
	// Journalling must never be what breaks a deploy, and on a rolled-back
	// PostgreSQL run the connection may still be unusable.
	await recordJournal(db, entries).catch(() => undefined);

	if (error) throw error;
	return { mode, applied };
}

export async function migrationStatus(db: Kysely<any>, kind: DatabaseKind) {
	await ensureBookkeeping(db);
	const defs = createMigrations(kind);
	const list = await newMigrator(db, kind).getMigrations();
	return list.map((m) => ({
		name: m.name,
		applied: m.executedAt !== undefined,
		executedAt: m.executedAt ?? null,
		compatibility: defs[m.name]?.compatibility ?? "expand",
		safeSince: defs[m.name]?.safeSince ?? null,
	}));
}
