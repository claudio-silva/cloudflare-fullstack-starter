import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { createDb } from "../src/worker/db";
import { pruneExpiredAuthRows } from "../src/worker/lib/expired-auth-rows";
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
		expect(res.status).not.toBe(403);
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
