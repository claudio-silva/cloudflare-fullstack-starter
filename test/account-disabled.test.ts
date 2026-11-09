import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { createDb } from "../src/worker/db";
import { pruneExpiredAuthRows } from "../src/worker/lib/expired-auth-rows";
import { Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type DatabaseConnection, type Driver, type Dialect } from "kysely";
import { sessionMarkerInsert } from "../src/worker/lib/session-revocations";
import type { Database } from "../src/worker/types/database";
import { isAccountDisabledBody } from "../src/shared/account-status";

// "local" so sign-ins are real (the "test" environment stubs the session).
const local = { ...env, ENVIRONMENT: "local" };
const json = { "content-type": "application/json" };
const cliKey = { "x-api-key": env.CLI_API_KEY as string };

let n = 0;
async function newUser(role = "user") {
	const email = `disabled-${Date.now()}-${n++}@example.com`;
	const res = await app.request("/api/cli/users", { method: "POST", headers: { ...json, ...cliKey }, body: JSON.stringify({ email, password: "password-123", role }) }, local);
	expect(res.status).toBe(200);
	const { userId } = (await res.json()) as { userId: string };
	return { id: userId, email };
}
async function signIn(email: string, e: object = local) {
	const res = await app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password: "password-123" }) }, e);
	expect(res.status).toBe(200);
	return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const setEnabled = (email: string, enabled: boolean) =>
	app.request(`/api/cli/users/${encodeURIComponent(email)}/enabled`, { method: "PUT", headers: { ...json, ...cliKey }, body: JSON.stringify({ enabled }) }, local);
const call = (path: string, cookie: string | null, init: { method?: string; env?: object } = {}) =>
	app.request(path, { method: init.method ?? "GET", headers: { ...(cookie ? { cookie } : {}), ...(init.method === "POST" ? { ...json, origin: new URL(local.APP_BASE_URL as string).origin } : {}) }, body: init.method === "POST" ? "{}" : undefined }, init.env ?? local);
const ping = (cookie: string | null, e?: object) => call("/api/protected/ping", cookie, { env: e });

async function expectDisabled(res: Response) {
	expect(res.status).toBe(403);
	expect(isAccountDisabledBody(await res.json())).toBe(true);
}

describe("a disabled account is told so, never that its session expired", () => {
	it("answers a protected route with 403 account_disabled", async () => {
		const u = await newUser();
		const cookie = await signIn(u.email);
		expect((await ping(cookie)).status).toBe(200);
		expect((await setEnabled(u.email, false)).status).toBe(200);
		const res = await ping(cookie);
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ code: "account_disabled", level: "info", requestId: expect.any(String) });
	});

	it("answers get-session with 403 and no Set-Cookie, so the token is kept", async () => {
		const u = await newUser();
		const cookie = await signIn(u.email);
		await setEnabled(u.email, false);
		const res = await call("/api/auth/get-session", cookie);
		await expectDisabled(res);
		expect(res.headers.get("set-cookie")).toBeNull();
		// Still the same answer next time: the token was not deleted.
		await expectDisabled(await call("/api/auth/get-session", cookie));
	});

	it("answers the rest of the Better Auth catch-all with 403", async () => {
		const u = await newUser();
		const cookie = await signIn(u.email);
		await setEnabled(u.email, false);
		await expectDisabled(await call("/api/auth/list-sessions", cookie));
	});

	it("leaves sign-out alone", async () => {
		const u = await newUser();
		const cookie = await signIn(u.email);
		await setEnabled(u.email, false);
		const res = await call("/api/auth/sign-out", cookie, { method: "POST" });
		expect(res.status).toBe(200);
		// The cookie-clearing Set-Cookie still reaches the browser.
		const cleared = res.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="));
		expect(cleared).toBeDefined();
		expect(cleared).toMatch(/max-age=0/i);
	});

	it("goes back to 401 unauthenticated once the account is enabled again", async () => {
		const u = await newUser();
		const cookie = await signIn(u.email);
		await setEnabled(u.email, false);
		await setEnabled(u.email, true);
		const res = await ping(cookie);
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ code: "unauthenticated" });
	});

	it("keeps 401 unauthenticated for a request that never signed in", async () => {
		const res = await ping(null);
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ code: "unauthenticated" });
	});

	it("keeps 401 unauthenticated after a normal sign-out", async () => {
		const u = await newUser();
		const cookie = await signIn(u.email);
		expect((await call("/api/auth/sign-out", cookie, { method: "POST" })).status).toBe(200);
		const res = await ping(cookie);
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ code: "unauthenticated" });
	});

	it("answers the same when an administrator disables the account", async () => {
		const admin = await newUser("superadmin");
		const adminCookie = await signIn(admin.email);
		const u = await newUser();
		const cookie = await signIn(u.email);
		const res = await app.request(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { ...json, cookie: adminCookie }, body: JSON.stringify({ enabled: false }) }, local);
		expect(res.status).toBe(200);
		await expectDisabled(await ping(cookie));
		// Re-enabling through the admin area turns the marker off too.
		await app.request(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { ...json, cookie: adminCookie }, body: JSON.stringify({ enabled: true }) }, local);
		expect((await ping(cookie)).status).toBe(401);
	});

	it("prunes expired markers and keeps live ones", async () => {
		const db = createDb(local);
		const u = await newUser();
		const row = (token: string, expires: number) => ({
			token,
			user_id: u.id,
			reason: "account_disabled",
			expires_at: new Date(expires).toISOString(),
			created_at: new Date().toISOString(),
		});
		await db.insertInto("session_revocations").values([row("expired-token", Date.now() - 60_000), row("live-token", Date.now() + 3_600_000)]).execute();
		await pruneExpiredAuthRows(local);
		const left = (await db.selectFrom("session_revocations").select("token").where("user_id", "=", u.id).execute()).map((r) => r.token);
		expect(left).toEqual(["live-token"]);
	});

	it("drops a user's markers when the user is deleted", async () => {
		const db = createDb(local);
		const u = await newUser();
		await signIn(u.email);
		await setEnabled(u.email, false);
		expect((await db.selectFrom("session_revocations").select("token").where("user_id", "=", u.id).execute()).length).toBeGreaterThan(0);
		const res = await app.request(`/api/cli/users/${encodeURIComponent(u.email)}`, { method: "DELETE", headers: cliKey }, local);
		expect(res.status).toBe(200);
		expect(await db.selectFrom("session_revocations").select("token").where("user_id", "=", u.id).execute()).toEqual([]);
	});

	it("reads no marker on the success path", async () => {
		const u = await newUser();
		const cookie = await signIn(u.email);
		const statements: string[] = [];
		const spied = new Proxy(env.DB, {
			get(target, prop) {
				const value = Reflect.get(target, prop, target);
				if (prop === "prepare") {
					return (sql: string) => {
						statements.push(sql);
						return target.prepare(sql);
					};
				}
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const res = await ping(cookie, { ...local, DB: spied });
		expect(res.status).toBe(200);
		expect(statements.length).toBeGreaterThan(0); // the spy sees the session read
		// (Kysely's one-off table introspection names every table; that is not a marker read.)
		expect(statements.filter((s) => s.includes("session_revocations") && !s.includes("pragma_table_info"))).toEqual([]);
	});
});

// Compile-only: a Kysely on each dialect that never connects, to see the SQL the portable insert produces.
function compiling(kind: "sqlite" | "mysql" | "postgres") {
	const make = {
		sqlite: { adapter: () => new SqliteAdapter(), compiler: () => new SqliteQueryCompiler(), introspector: (db: Kysely<unknown>) => new SqliteIntrospector(db) },
		mysql: { adapter: () => new MysqlAdapter(), compiler: () => new MysqlQueryCompiler(), introspector: (db: Kysely<unknown>) => new MysqlIntrospector(db) },
		postgres: { adapter: () => new PostgresAdapter(), compiler: () => new PostgresQueryCompiler(), introspector: (db: Kysely<unknown>) => new PostgresIntrospector(db) },
	}[kind];
	const dialect: Dialect = {
		createAdapter: make.adapter,
		createQueryCompiler: make.compiler,
		createIntrospector: make.introspector,
		createDriver: (): Driver => ({ init: async () => {}, acquireConnection: async () => ({}) as DatabaseConnection, beginTransaction: async () => {}, commitTransaction: async () => {}, rollbackTransaction: async () => {}, releaseConnection: async () => {}, destroy: async () => {} }),
	};
	return new Kysely<Database>({ dialect });
}

describe("the marker insert is portable", () => {
	const row = { token: "t", userId: "u", expiresAt: "2030-01-01" };
	const sql = (kind: "sqlite" | "mysql" | "postgres") =>
		sessionMarkerInsert(compiling(kind), [row], new Date("2030-01-01"), kind).compile().sql.toLowerCase();

	it("uses INSERT IGNORE on MySQL, never ON CONFLICT", () => {
		expect(sql("mysql")).toContain("insert ignore into");
		expect(sql("mysql")).not.toContain("on conflict");
	});
	it("uses ON CONFLICT DO NOTHING on SQLite and PostgreSQL", () => {
		expect(sql("sqlite")).toContain("on conflict do nothing");
		expect(sql("postgres")).toContain("on conflict do nothing");
	});
});
