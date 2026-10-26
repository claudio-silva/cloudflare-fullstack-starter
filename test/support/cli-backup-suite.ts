import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql, type Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { applyRestore, prepareRestore, readBackup, writeBackup } from "../../src/cli/utils/backup";
import type { CliDatabaseClient } from "../../src/cli/utils/db";
import { dbNow, type DatabaseKind } from "../../src/worker/db";
import { appliedMigrations, clearTable, describeSchema, exportRows, finishTable, importRows, restoreChunkRows, type EncodedRow } from "../../src/worker/db/backup";
import { migrateDatabase } from "../../src/worker/db/migrations";
import { createProjectTables } from "./project-tables";

type AnyDb = Kysely<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What the CLI would get from the Worker's backup/restore API, wired straight to a database (JSON-roundtripped like HTTP). */
function clientFor(db: AnyDb, kind: DatabaseKind): CliDatabaseClient {
	const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
	const table = async (name: string) => (await describeSchema(db, kind)).find((t) => t.name === name)!;
	const client: Partial<CliDatabaseClient> = {
		migrate: () => migrateDatabase(db, { kind }),
		backupInfo: async () => ({
			kind,
			migrations: await appliedMigrations(db),
			tables: (await describeSchema(db, kind)).map((t) => ({ name: t.name, columns: t.columns.map((c) => c.name), primaryKey: t.primaryKey, restoreChunkRows: restoreChunkRows(kind, t) })),
		}),
		backupRows: async (name, offset, limit) => json(await exportRows(db, await table(name), offset, limit)),
		restoreClear: async (name) => clearTable(db, await table(name)),
		restoreRows: async (name, rows) => importRows(db, kind, await table(name), json(rows) as EncodedRow[]),
		restoreFinish: async (name) => finishTable(db, kind, await table(name)),
	};
	return client as CliDatabaseClient;
}

/** The CLI side of backup/restore (file format, verification, paging) against a real database. Runs in Node only (needs node:fs). */
export function defineCliBackupSuite(label: string, kind: DatabaseKind, fresh: () => Promise<AnyDb>) {
	describe(`CLI backup files on ${label}`, () => {
		it("CLI backup file: writes, verifies and restores (also into a fresh database), and refuses mismatches", async () => {
			const db = (await fresh()) as AnyDb;
			await migrateDatabase(db, { kind });
			await createProjectTables(db, kind);
			const now = dbNow(kind);
			await db.insertInto("users").values({ id: "u1", email: "a@example.com", createdAt: now, updatedAt: now }).execute();
			// In batches: 1200 single-row inserts made this the one test that a busy machine could push past its timeout.
			// 100 per statement keeps under D1's limit of 100 bound parameters, should this suite ever run there.
			for (let i = 0; i < 1200; i += 100) {
				const batch = Array.from({ length: 100 }, (_, j) => ({ title: `row ${i + j}` }));
				await db.insertInto("z_parent").values(batch).execute();
			}
			const count = async (d: AnyDb) => Number((await d.selectFrom("z_parent").select(sql<number>`count(*)`.as("n")).executeTakeFirstOrThrow()).n);

			const dir = mkdtempSync(join(tmpdir(), "backup-test-"));
			const file = join(dir, "x.backup.jsonl");
			const client = clientFor(db, kind);
			const written = await writeBackup(client, "test", file, () => undefined);
			expect(written.rows).toBe(1201);

			const { header, counts } = await readBackup(file);
			expect(counts).toEqual({ users: 1, z_parent: 1200 });
			expect(header.migrations).toEqual(["0001_initial", "0002_add_role", "0003_account_token_columns", "0004_login_events", "0005_credential_account_ids"]);

			// Damage the live data, then restore (1200 rows are paged: more than one page, more than one restore chunk).
			await db.deleteFrom("a_child").execute();
			await db.deleteFrom("z_parent").where("id", ">", 10).execute();
			await db.deleteFrom("sessions").execute();
			await db.deleteFrom("users").execute();
			const { info, warnings } = await prepareRestore(client, header);
			expect(warnings).toEqual([]);
			await applyRestore(client, file, counts, info, () => undefined);
			expect(await count(db)).toBe(1200);
			expect((await db.selectFrom("users").select("email").execute()).map((u) => u.email)).toEqual(["a@example.com"]);

			// A fresh database is migrated by the restore itself, but must have the project's tables.
			const empty = (await fresh()) as AnyDb;
			await migrateDatabase(empty, { kind });
			await createProjectTables(empty, kind);
			const target = clientFor(empty, kind);
			const prepared = await prepareRestore(target, header);
			await applyRestore(target, file, counts, prepared.info, () => undefined);
			expect(await count(empty)).toBe(1200);

			// Truncated files are rejected before anything is touched.
			const lines = readFileSync(file, "utf8").trimEnd().split("\n");
			const truncated = join(dir, "t.backup.jsonl");
			writeFileSync(truncated, `${lines.slice(0, -1).join("\n")}\n`);
			await expect(readBackup(truncated)).rejects.toThrow(/incomplete/);
			const tampered = join(dir, "c.backup.jsonl");
			writeFileSync(tampered, `${[lines[0], ...lines.slice(2)].join("\n")}\n`);
			await expect(readBackup(tampered)).rejects.toThrow(/corrupt/);

			// A database at another schema version is refused.
			await db.deleteFrom("kysely_migration").where("name", "=", "0003_account_token_columns").execute();
			await expect(prepareRestore(client, header)).rejects.toThrow(/schema/);
		});
	});
}
