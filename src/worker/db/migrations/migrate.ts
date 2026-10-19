/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, type Kysely } from "kysely";
import { Migrator } from "kysely/migration";
import type { DatabaseKind } from "../index";
import { createBaseline, createMigrations } from "./index";

export type MigrateOptions = {
	kind: DatabaseKind;
	/** Run the incremental path even on an empty database (tests use this to prove both paths converge). */
	forceIncremental?: boolean;
};

export type MigrateResult = {
	mode: "baseline" | "adopted-legacy" | "incremental";
	applied: string[];
};

function newMigrator(db: Kysely<any>, kind: DatabaseKind) {
	return new Migrator({ db, provider: { getMigrations: async () => createMigrations(kind) } });
}

/** An empty-provider run creates the bookkeeping tables without applying anything. */
async function ensureBookkeeping(db: Kysely<any>) {
	await new Migrator({ db, provider: { getMigrations: async () => ({}) } }).migrateToLatest();
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

/**
 * - Fresh database: run the baseline once, mark the migrations it squashes as applied.
 * - Legacy D1 database (tracked by `wrangler d1 migrations`): adopt the matching migrations as applied.
 * - Then run any pending incremental migrations.
 */
export async function migrateDatabase(db: Kysely<any>, opts: MigrateOptions): Promise<MigrateResult> {
	await ensureBookkeeping(db);
	const migrator = newMigrator(db, opts.kind);
	const migrations = createMigrations(opts.kind);
	const nothingApplied = (await migrator.getMigrations()).every((m) => m.executedAt === undefined);

	let mode: MigrateResult["mode"] = "incremental";
	const applied: string[] = [];

	if (nothingApplied) {
		const legacy = await legacyD1Names(db);
		if (legacy.length > 0) {
			mode = "adopted-legacy";
			const matched = Object.entries(migrations).filter(([, m]) => m.legacyName && legacy.includes(m.legacyName)).map(([n]) => n);
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

	const { error, results } = await migrator.migrateToLatest();
	if (error) throw error;
	for (const r of results ?? []) if (r.status === "Success") applied.push(r.migrationName);
	return { mode, applied };
}

export async function migrationStatus(db: Kysely<any>, kind: DatabaseKind) {
	await ensureBookkeeping(db);
	const list = await newMigrator(db, kind).getMigrations();
	return list.map((m) => ({ name: m.name, applied: m.executedAt !== undefined, executedAt: m.executedAt ?? null }));
}
