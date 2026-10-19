import type { Kysely } from "kysely";
import { columnTypes } from "../columns";
import type { MigrationFactory } from "../types";

export const addRole: MigrationFactory = (kind) => {
	const t = columnTypes(kind);
	return {
		legacyName: "0002_add_role",
		async up(db: Kysely<unknown>) {
			// Built-in roles: user (default), admin. Add more in your own migrations.
			await db.schema.alterTable("users").addColumn("role", t.role, (c) => c.notNull().defaultTo("user")).execute();
			await db.schema.createIndex("idx_users_role").on("users").column("role").execute();
		},
	};
};
