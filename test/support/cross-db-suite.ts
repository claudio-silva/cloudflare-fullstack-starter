import { betterAuth } from "better-auth";
import { sql, type Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { dbBool, dbNow, ignoreConflict, toIso, type DatabaseKind } from "../../src/worker/db";
import { clearTable, describeSchema, exportRows, finishTable, importRows, type EncodedRow } from "../../src/worker/db/backup";
import { migrateDatabase } from "../../src/worker/db/migrations";
import type { Database } from "../../src/worker/types/database";
import { createProjectTables } from "./project-tables";
import { schemaSnapshot } from "./schema-snapshot";

type AnyDb = Kysely<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The same behavioural suite runs against every supported database (D1/SQLite, PostgreSQL, MySQL).
 * `fresh()` must return a brand-new, empty database each time it is called.
 */
export function defineCrossDbSuite(label: string, kind: DatabaseKind, fresh: () => Promise<AnyDb>) {
	describe(`${label} (${kind})`, () => {
		it("baseline and incremental migrations produce the same schema", async () => {
			const a = await fresh();
			const b = await fresh();
			expect((await migrateDatabase(a, { kind })).mode).toBe("baseline");
			expect((await migrateDatabase(b, { kind, forceIncremental: true })).mode).toBe("incremental");
			expect(await schemaSnapshot(a)).toEqual(await schemaSnapshot(b));
			expect((await schemaSnapshot(a)).map((t) => t.table)).toEqual(["accounts", "login_events", "sessions", "users", "verifications"]);
		});

		it("is idempotent and records the squashed migrations", async () => {
			const db = await fresh();
			await migrateDatabase(db, { kind });
			expect((await migrateDatabase(db, { kind })).applied).toEqual([]);
			const rows = await db.selectFrom("kysely_migration").select("name").orderBy("name").execute();
			expect(rows.map((r: { name: string }) => r.name)).toEqual(["0001_initial", "0002_add_role", "0003_account_token_columns", "0004_login_events"]);
		});

		it("supports the portable query subset the app uses", async () => {
			const db = (await fresh()) as Kysely<Database>;
			await migrateDatabase(db, { kind });
			const now = dbNow(kind);
			await db
				.insertInto("users")
				.values({ id: "u1", email: "MixedCase@example.com", name: "Mixed", createdAt: now, updatedAt: now, emailVerified: dbBool(true, kind) })
				.execute();

			const found = await db
				.selectFrom("users")
				.selectAll()
				.where((eb) => eb(sql`lower(${eb.ref("email")})`, "like", "%mixedcase%"))
				.execute();
			expect(found).toHaveLength(1);
			expect(found[0].role).toBe("user");
			expect(Boolean(found[0].emailVerified)).toBe(true);
			expect(toIso(found[0].createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(Math.abs(new Date(found[0].createdAt).getTime() - (now instanceof Date ? now.getTime() : Date.parse(now)))).toBeLessThan(2000);

			// Idempotent seed pattern
			const seed = () =>
				ignoreConflict(
					db.insertInto("users").values({ id: "seed-admin", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now }),
					kind,
				).execute();
			await seed();
			await seed();
			const count = await db.selectFrom("users").select(sql<number>`count(*)`.as("n")).where("id", "=", "seed-admin").executeTakeFirstOrThrow();
			expect(Number(count.n)).toBe(1);
		});

		it("backs up and restores the whole database, including project tables and every value type", async () => {
			const db = (await fresh()) as AnyDb;
			await migrateDatabase(db, { kind });
			await createProjectTables(db, kind);

			const now = dbNow(kind);
			await db.insertInto("users").values({ id: "u1", email: "a@example.com", name: "A", createdAt: now, updatedAt: now, emailVerified: dbBool(true, kind) }).execute();
			await db.insertInto("sessions").values({ id: "s1", userId: "u1", token: "tok", expiresAt: now, createdAt: now, updatedAt: now }).execute();
			await db.insertInto("z_parent").values({ title: "first" }).execute();
			await db.insertInto("z_parent").values({ title: "second" }).execute();
			await db
				.insertInto("a_child")
				.values({
					parent_id: 1,
					note: "it's \"quoted\"\nnew line ✓",
					done: dbBool(true, kind),
					stamp: now,
					payload: kind === "postgres" ? Buffer.from([0, 1, 254, 255]) : kind === "mysql" ? Buffer.from([0, 1, 254, 255]) : new Uint8Array([0, 1, 254, 255]),
					big: "9007199254740993",
					meta: JSON.stringify({ tags: ["a", "b"], n: 1 }),
					nothing: null,
				})
				.execute();

			const read = async () => ({
				users: await db.selectFrom("users").selectAll().orderBy("id").execute(),
				sessions: await db.selectFrom("sessions").selectAll().orderBy("id").execute(),
				z_parent: await db.selectFrom("z_parent").selectAll().orderBy("id").execute(),
				a_child: await db.selectFrom("a_child").selectAll().orderBy("id").execute(),
			});
			const before = await read();

			const schema = await describeSchema(db, kind);
			const names = schema.map((t) => t.name);
			expect(names).toEqual(expect.arrayContaining(["users", "sessions", "z_parent", "a_child"]));
			expect(names).not.toContain("kysely_migration");
			// Parents come before the tables that reference them, whatever the alphabet says.
			expect(names.indexOf("z_parent")).toBeLessThan(names.indexOf("a_child"));
			expect(names.indexOf("users")).toBeLessThan(names.indexOf("sessions"));
			expect(schema.find((t) => t.name === "z_parent")?.primaryKey).toEqual(["id"]);

			// Export through JSON, as the CLI does, paging two rows at a time.
			const dump = new Map<string, EncodedRow[]>();
			for (const table of schema) {
				const rows: EncodedRow[] = [];
				for (let offset = 0; ; offset += 2) {
					const page = JSON.parse(JSON.stringify(await exportRows(db, table, offset, 2))) as EncodedRow[];
					rows.push(...page);
					if (page.length < 2) break;
				}
				dump.set(table.name, rows);
			}
			expect(dump.get("z_parent")).toHaveLength(2);

			// Wipe, then restore in dependency order.
			for (const table of [...schema].reverse()) await clearTable(db, table);
			expect((await read()).z_parent).toHaveLength(0);
			for (const table of schema) {
				const rows = dump.get(table.name)!;
				await importRows(db, kind, table, rows);
				expect((await finishTable(db, kind, table)).rowCount).toBe(rows.length);
			}
			expect(await read()).toEqual(before);

			// Generated ids continue after the restored ones (PostgreSQL sequences are moved past them).
			await db.insertInto("z_parent").values({ title: "third" }).execute();
			expect((await db.selectFrom("z_parent").select("id").orderBy("id").execute()).map((r) => Number(r.id))).toEqual([1, 2, 3]);
		});

		it("refuses to restore rows for columns the database does not have", async () => {
			const db = (await fresh()) as AnyDb;
			await migrateDatabase(db, { kind });
			const users = (await describeSchema(db, kind)).find((t) => t.name === "users")!;
			await expect(importRows(db, kind, users, [{ id: "x", nope: 1 }])).rejects.toThrow(/does not exist/);
		});

		it("runs Better Auth sign-up and sign-in", async () => {
			const db = await fresh();
			await migrateDatabase(db, { kind });
			const auth = betterAuth({
				secret: "cross-db-test-secret-cross-db-test-secret",
				baseURL: "http://localhost:5173",
				database: { db, type: kind },
				user: { modelName: "users" },
				session: { modelName: "sessions" },
				account: { modelName: "accounts" },
				verification: { modelName: "verifications" },
				emailAndPassword: { enabled: true },
			});
			const up = await auth.api.signUpEmail({ body: { email: "ba@example.com", password: "password-123!", name: "BA" } });
			expect(up.user.email).toBe("ba@example.com");
			const inn = await auth.api.signInEmail({ body: { email: "ba@example.com", password: "password-123!" } });
			expect(inn.token).toBeTruthy();
			const row = await db.selectFrom("users").select(["createdAt", "emailVerified"]).where("email", "=", "ba@example.com").executeTakeFirstOrThrow();
			expect(toIso(row.createdAt)).toMatch(/^\d{4}-/);
			expect(Boolean(row.emailVerified)).toBe(false);
		});
	});
}
