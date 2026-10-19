import type { Kysely } from "kysely";
import type { DatabaseKind } from "../../src/worker/db";
import { columnTypes } from "../../src/worker/db/migrations/columns";

type AnyDb = Kysely<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Project-owned tables with a foreign key (child sorts before parent alphabetically), generated ids and every value type. */
export async function createProjectTables(db: AnyDb, kind: DatabaseKind) {
	const t = columnTypes(kind);
	await db.schema
		.createTable("z_parent")
		.addColumn("id", kind === "postgres" ? "serial" : "integer", (c) => (kind === "postgres" ? c.primaryKey() : c.primaryKey().autoIncrement()))
		.addColumn("title", t.short, (c) => c.notNull())
		.execute();
	await db.schema
		.createTable("a_child")
		.addColumn("id", kind === "postgres" ? "serial" : "integer", (c) => (kind === "postgres" ? c.primaryKey() : c.primaryKey().autoIncrement()))
		.addColumn("parent_id", "integer", (c) => c.notNull())
		.addColumn("note", t.text)
		.addColumn("done", t.boolean)
		.addColumn("stamp", t.timestamp)
		.addColumn("payload", kind === "postgres" ? "bytea" : "blob")
		.addColumn("big", "bigint")
		.addColumn("meta", kind === "postgres" ? "jsonb" : kind === "mysql" ? "json" : "text")
		.addColumn("nothing", t.text)
		// MySQL ignores inline `references`: declare the foreign key as a table constraint.
		.addForeignKeyConstraint("a_child_parent_fk", ["parent_id"], "z_parent", ["id"])
		.execute();
}

