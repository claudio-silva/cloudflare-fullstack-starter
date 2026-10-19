import { env } from "cloudflare:workers";
import { sql, Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { D1Dialect } from "../src/worker/db/d1-dialect";
import { migrateDatabase } from "../src/worker/db/migrations";
import { createMigrations } from "../src/worker/db/migrations";
import { defineCrossDbSuite } from "./support/cross-db-suite";

// D1 binding used for isolated migration runs (the default DB already has migrations applied by the test setup).
const bindings = [(env as any).DB2, (env as any).DB3] as D1Database[]; // eslint-disable-line @typescript-eslint/no-explicit-any
let next = 0;

async function freshD1() {
	const db = new Kysely<any>({ dialect: new D1Dialect({ database: bindings[next++ % 2] }) }); // eslint-disable-line @typescript-eslint/no-explicit-any
	const { rows } = await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'`.execute(db);
	await sql`pragma foreign_keys = off`.execute(db);
	for (const r of rows) await sql.raw(`drop table if exists "${r.name}"`).execute(db);
	return db;
}

defineCrossDbSuite("Cloudflare D1", "sqlite", freshD1);

describe("D1 specifics", () => {
	it("adopts databases tracked by the legacy `wrangler d1 migrations` table", async () => {
		const db = await freshD1();
		const migrations = createMigrations("sqlite");
		// Simulate an old install that had applied only the first two legacy migrations.
		await migrations["0001_initial"].up(db);
		await migrations["0002_add_role"].up(db);
		await sql`create table d1_migrations (id integer primary key autoincrement, name text unique, applied_at text default current_timestamp)`.execute(db);
		await sql`insert into d1_migrations (name) values ('0001_initial_schema.sql'), ('0002_add_role.sql')`.execute(db);

		const result = await migrateDatabase(db, { kind: "sqlite" });
		expect(result.mode).toBe("adopted-legacy");
		expect(result.applied).toEqual(["0003_account_token_columns"]);
	});

	it("refuses to guess when a legacy tracker matches no known migration", async () => {
		const db = await freshD1();
		await sql`create table d1_migrations (id integer primary key autoincrement, name text unique, applied_at text default current_timestamp)`.execute(db);
		await sql`insert into d1_migrations (name) values ('0001_something_unknown.sql')`.execute(db);
		await expect(migrateDatabase(db, { kind: "sqlite" })).rejects.toThrow(/legacy d1_migrations table/);
	});

	it("D1 does not support transactions (documented limitation; starter code does not use them)", async () => {
		const db = await freshD1();
		await expect(db.transaction().execute(async () => undefined)).rejects.toThrow(/Transactions are not supported/);
	});
});
