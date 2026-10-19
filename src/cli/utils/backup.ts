import { appendFileSync, createReadStream, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { BackupInfo, CliDatabaseClient } from "./db";

/**
 * Backup file format: JSON Lines, one record per line.
 *   1. header  { format, version, createdAt, environment, kind, migrations, tables: [{ name, columns }] }
 *   2. rows    { table, rows: [...] }   (as many lines per table as needed, tables in dependency order)
 *   3. end     { end: true, rows: { <table>: <count> } }
 * The end record lets a restore detect a truncated file before touching the database. Row values are
 * produced and consumed by the Worker (`src/worker/db/backup.ts`); this file treats them as opaque JSON.
 */
const FORMAT = "starter-backup";
const PAGE_SIZE = 500;

export type BackupHeader = {
	format: typeof FORMAT;
	version: 1;
	createdAt: string;
	environment: string;
	kind: BackupInfo["kind"];
	migrations: string[];
	tables: Array<{ name: string; columns: string[] }>;
};

type RowsRecord = { table: string; rows: unknown[] };
type EndRecord = { end: true; rows: Record<string, number> };

/** Pages through every data table and writes a backup file. The file only appears once it is complete. */
export async function writeBackup(
	client: CliDatabaseClient,
	environment: string,
	file: string,
	log: (message: string) => void = console.log,
): Promise<{ tables: number; rows: number }> {
	const info = await client.backupInfo();
	const header: BackupHeader = {
		format: FORMAT,
		version: 1,
		createdAt: new Date().toISOString(),
		environment,
		kind: info.kind,
		migrations: info.migrations,
		tables: info.tables.map((t) => ({ name: t.name, columns: t.columns })),
	};
	mkdirSync(dirname(file), { recursive: true });
	const partial = `${file}.partial`;
	writeFileSync(partial, `${JSON.stringify(header)}\n`);

	try {
		const counts: Record<string, number> = {};
		for (const table of info.tables) {
			let total = 0;
			for (;;) {
				const rows = await client.backupRows(table.name, total, PAGE_SIZE);
				if (rows.length > 0) appendFileSync(partial, `${JSON.stringify({ table: table.name, rows } satisfies RowsRecord)}\n`);
				total += rows.length;
				if (rows.length < PAGE_SIZE) break;
			}
			counts[table.name] = total;
			log(`  ${table.name}: ${total} row(s)`);
		}
		appendFileSync(partial, `${JSON.stringify({ end: true, rows: counts } satisfies EndRecord)}\n`);
		renameSync(partial, file);
		return { tables: info.tables.length, rows: Object.values(counts).reduce((a, b) => a + b, 0) };
	} catch (error) {
		if (existsSync(partial)) unlinkSync(partial);
		throw error;
	}
}

async function* readRecords(file: string): AsyncGenerator<Record<string, unknown>> {
	const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
	for await (const line of lines) {
		if (line.trim()) yield JSON.parse(line) as Record<string, unknown>;
	}
}

/** Reads the whole file once to make sure it is a complete backup; returns its header and row counts. */
export async function readBackup(file: string): Promise<{ header: BackupHeader; counts: Record<string, number> }> {
	let header: BackupHeader | undefined;
	let end: EndRecord | undefined;
	const counts: Record<string, number> = {};
	try {
		for await (const record of readRecords(file)) {
			if (!header) {
				if (record.format !== FORMAT) throw new Error("not a backup file written by `db backup`");
				header = record as unknown as BackupHeader;
			} else if ("end" in record) {
				end = record as unknown as EndRecord;
			} else {
				const { table, rows } = record as unknown as RowsRecord;
				counts[table] = (counts[table] ?? 0) + rows.length;
			}
		}
	} catch (error) {
		throw new Error(`Cannot read backup ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	if (!header) throw new Error(`Backup ${file} is empty.`);
	if (!end) throw new Error(`Backup ${file} is incomplete (no end record); it was probably interrupted.`);
	for (const table of header.tables) {
		if ((end.rows[table.name] ?? 0) !== (counts[table.name] ?? 0)) throw new Error(`Backup ${file} is corrupt: row count of "${table.name}" does not match.`);
	}
	return { header, counts };
}

/**
 * Checks that the backup fits the target database and returns the target's schema.
 * A fresh database (no migrations yet) is migrated first; any other mismatch is an error, because a
 * backup holds data only and the schema belongs to the migrations (check out the project version the
 * backup was taken with, or migrate the database to it, then restore).
 */
export async function prepareRestore(client: CliDatabaseClient, header: BackupHeader): Promise<{ info: BackupInfo; warnings: string[] }> {
	let info = await client.backupInfo();
	if (info.migrations.length === 0) {
		await client.migrate();
		info = await client.backupInfo();
	}
	if (JSON.stringify(info.migrations) !== JSON.stringify(header.migrations)) {
		throw new Error(
			`The backup was taken at schema [${header.migrations.join(", ")}] but the database is at [${info.migrations.join(", ")}]. ` +
				"Restore with the project version the backup was taken with (then migrate), or migrate the database to the backup's version first.",
		);
	}
	const target = new Map(info.tables.map((t) => [t.name, t]));
	for (const table of header.tables) {
		const live = target.get(table.name);
		if (!live) throw new Error(`The database has no table "${table.name}".`);
		const missing = table.columns.filter((c) => !live.columns.includes(c));
		if (missing.length > 0) throw new Error(`Table "${table.name}" has no column(s): ${missing.join(", ")}.`);
	}
	const warnings: string[] = [];
	if (header.kind !== info.kind) warnings.push(`The backup comes from a ${header.kind} database and is restored into ${info.kind}: values are converted on a best-effort basis.`);
	return { info, warnings };
}

/** Replaces the contents of every data table with the rows in the backup. Not atomic: take a safety backup first. */
export async function applyRestore(
	client: CliDatabaseClient,
	file: string,
	counts: Record<string, number>,
	info: BackupInfo,
	log: (message: string) => void = console.log,
): Promise<void> {
	for (const table of [...info.tables].reverse()) await client.restoreClear(table.name);
	log(`Cleared ${info.tables.length} table(s).`);

	const chunkRows = new Map(info.tables.map((t) => [t.name, t.restoreChunkRows]));
	for await (const record of readRecords(file)) {
		if (!("table" in record)) continue;
		const { table, rows } = record as unknown as RowsRecord;
		const size = chunkRows.get(table) ?? 100;
		for (let i = 0; i < rows.length; i += size) await client.restoreRows(table, rows.slice(i, i + size));
	}

	for (const table of info.tables) {
		const { rowCount } = await client.restoreFinish(table.name);
		const expected = counts[table.name] ?? 0;
		if (rowCount !== expected) throw new Error(`Restored table "${table.name}" has ${rowCount} row(s), the backup has ${expected}.`);
		log(`  ${table.name}: ${rowCount} row(s)`);
	}
}
