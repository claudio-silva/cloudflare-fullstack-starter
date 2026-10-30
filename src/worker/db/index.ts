import { Kysely, sql, type InsertQueryBuilder, type RawBuilder } from "kysely";
import { D1Dialect } from "./d1-dialect";
import type { Database, Timestamp } from "../types/database";
import type { AppEnv } from "../types/env";

export type DatabaseKind = "sqlite" | "postgres" | "mysql";

/**
 * SQL family of the database the app talks to. It selects column types in
 * migrations, the Better Auth adapter mode and how timestamps are written.
 * Change it together with `createDb` when switching databases (docs/DATABASES.md).
 */
export const databaseKind: DatabaseKind = "sqlite";

/**
 * The single place where the app's database connection is created.
 *
 * Routes, middleware and auth all call `createDb(c.env)`; none of them builds a
 * Kysely instance or names a dialect.
 */
export function createDb(env: Pick<AppEnv, "DB">): Kysely<Database> {
	if (!env.DB) {
		throw new Error("Database binding (DB) is not available");
	}
	return new Kysely<Database>({ dialect: new D1Dialect({ database: env.DB }) });
}

/**
 * Timestamp value to write in a datetime column. SQLite drivers cannot bind `Date`
 * objects (Better Auth stores ISO strings there); Postgres/MySQL drivers take `Date`.
 */
export function dbNow(kind: DatabaseKind = databaseKind): Date | string {
	const now = new Date();
	return kind === "sqlite" ? now.toISOString() : now;
}

/** Boolean value to write: SQLite drivers take 0/1, PostgreSQL/MySQL take booleans. */
export function dbBool(value: boolean, kind: DatabaseKind = databaseKind): boolean | number {
	return kind === "sqlite" ? (value ? 1 : 0) : value;
}

/** Normalise a driver timestamp to an ISO string (what APIs return). */
export function toIso(value: Timestamp | null | undefined): string | null {
	return value == null ? null : new Date(value).toISOString();
}

/** Whole seconds from one datetime column to another, in SQL (date arithmetic differs on every database). */
export function dbSecondsBetween(from: string, to: string, kind: DatabaseKind = databaseKind): RawBuilder<number> {
	const a = sql.ref(from);
	const b = sql.ref(to);
	if (kind === "postgres") return sql<number>`cast(extract(epoch from (${b} - ${a})) as integer)`;
	if (kind === "mysql") return sql<number>`timestampdiff(second, ${a}, ${b})`;
	return sql<number>`cast(round((julianday(${b}) - julianday(${a})) * 86400) as integer)`;
}

/**
 * Portable "insert, skip if the row already exists" (idempotent seeds).
 * PostgreSQL and SQLite use `ON CONFLICT DO NOTHING`; MySQL uses `INSERT IGNORE`.
 */
export function ignoreConflict<DB, TB extends keyof DB & string, O>(
	query: InsertQueryBuilder<DB, TB, O>,
	kind: DatabaseKind = databaseKind,
): InsertQueryBuilder<DB, TB, O> {
	return kind === "mysql" ? query.ignore() : query.onConflict((oc) => oc.doNothing());
}
