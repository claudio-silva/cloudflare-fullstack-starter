import { PGlite } from "@electric-sql/pglite";
import { Kysely, MysqlDialect, PGliteDialect, PostgresDialect } from "kysely";
import { createPool } from "mysql2";
import pg from "pg";
import { describe } from "vitest";
import { defineCrossDbSuite } from "../support/cross-db-suite";

// PGlite (embedded Postgres in WASM) always runs. Real servers run when their URL is set:
//   TEST_POSTGRES_URL=postgres://postgres:test@localhost:35432/starter_test
//   TEST_MYSQL_URL=mysql://root:test@localhost:33306/starter_test
// (see docs/DATABASES.md for the one-line docker commands; CI starts both as services)

defineCrossDbSuite("PGlite", "postgres", async () => new Kysely({ dialect: new PGliteDialect({ pglite: new PGlite() }) }));

let counter = 0;
const uniqueName = () => `t_${Date.now().toString(36)}_${counter++}`;

const postgresUrl = process.env.TEST_POSTGRES_URL;
describe.skipIf(!postgresUrl)("PostgreSQL server", () => {
	defineCrossDbSuite("PostgreSQL", "postgres", async () => {
		const name = uniqueName();
		const admin = new pg.Client({ connectionString: postgresUrl });
		await admin.connect();
		await admin.query(`create database ${name}`);
		await admin.end();
		const url = new URL(postgresUrl!);
		url.pathname = `/${name}`;
		return new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url.toString(), max: 2 }) }) });
	});
});

const mysqlUrl = process.env.TEST_MYSQL_URL;
describe.skipIf(!mysqlUrl)("MySQL server", () => {
	defineCrossDbSuite("MySQL", "mysql", async () => {
		const name = uniqueName();
		const admin = createPool({ uri: mysqlUrl!, connectionLimit: 1 });
		await admin.promise().query(`create database ${name}`);
		await admin.promise().end();
		const url = new URL(mysqlUrl!);
		url.pathname = `/${name}`;
		return new Kysely({ dialect: new MysqlDialect({ pool: createPool({ uri: url.toString(), connectionLimit: 2, timezone: "Z" }) }) });
	});
});
