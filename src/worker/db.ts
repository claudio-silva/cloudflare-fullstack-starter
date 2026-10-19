import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Database } from "./types/database";
import type { AppEnv } from "./types/env";

/**
 * The single place where the app's database connection is created.
 *
 * Routes, middleware and auth all call `createDb(c.env)`; none of them builds a
 * Kysely instance or names a dialect. To use another SQL database (or to add a
 * second one), change it here. See docs/DATABASES.md.
 */
export function createDb(env: Pick<AppEnv, "DB">): Kysely<Database> {
	if (!env.DB) {
		throw new Error("Database binding (DB) is not available");
	}
	return new Kysely<Database>({ dialect: new D1Dialect({ database: env.DB }) });
}
