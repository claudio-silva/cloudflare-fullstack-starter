import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { BINDING_EXEMPT_AUTH_SEGMENTS, isBindingExemptAuthPath } from "../src/worker/lib/auth-requests";
import { isSessionChangedBody } from "../src/shared/session-binding";
import { createDb, dbTime } from "../src/worker/db";
import { sessionTokenFromHeaders } from "../src/worker/lib/session-revocations";

/**
 * Per-tab session binding on the server: a request carrying an X-Session-Id that is not the
 * session its cookie resolves to is refused 409 before any handler runs; none carried, no check.
 */

// "local" so sign-ins are real (the "test" environment stubs the session).
const local = { ...env, ENVIRONMENT: "local" };
const json = { "content-type": "application/json" };
const cliKey = { "x-api-key": env.CLI_API_KEY as string };
const origin = new URL(local.APP_BASE_URL as string).origin;

let n = 0;
async function newUser() {
	const email = `binding-${Date.now()}-${n++}@example.com`;
	const res = await app.request("/api/cli/users", { method: "POST", headers: { ...json, ...cliKey }, body: JSON.stringify({ email, password: "password-123", role: "user" }) }, local);
	expect(res.status).toBe(200);
	return { email, id: ((await res.json()) as { userId: string }).userId };
}
async function signIn(email: string) {
	const res = await app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password: "password-123" }) }, local);
	expect(res.status).toBe(200);
	return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
/** A signed-in user: its cookie and the id of the session behind it. */
async function login() {
	const user = await newUser();
	const cookie = await signIn(user.email);
	const res = await app.request("/api/auth/get-session", { headers: { cookie } }, local);
	const { session } = (await res.json()) as { session: { id: string } };
	return { ...user, cookie, sessionId: session.id };
}
/** Makes the session due for a refresh (a matched request would push its expiry and set the cookie). */
async function ageSession(cookie: string) {
	const db = createDb(local);
	const token = sessionTokenFromHeaders(new Headers({ cookie }))!;
	const r = await db.selectFrom("sessions").select(["expiresAt", "updatedAt"]).where("token", "=", token).executeTakeFirstOrThrow();
	await db.updateTable("sessions").set({ updatedAt: dbTime(new Date(new Date(r.updatedAt).getTime() - 120_000)), expiresAt: dbTime(new Date(new Date(r.expiresAt).getTime() - 120_000)) }).where("token", "=", token).execute();
}
const setsSessionCookie = (res: Response) => res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="));
const ping = (cookie: string | null, sid?: string, e: object = local) =>
	app.request("/api/protected/ping", { headers: { ...(cookie ? { cookie } : {}), ...(sid ? { "x-session-id": sid } : {}) } }, e);
const auth = (method: string, path: string, cookie: string | null, sid?: string, body = "{}") =>
	app.request(`/api/auth/${path}`, { method, headers: { ...json, origin, ...(cookie ? { cookie } : {}), ...(sid ? { "x-session-id": sid } : {}) }, body: method === "GET" ? undefined : body }, local);

describe("authMiddleware", () => {
	it("a mismatching id is refused 409 session_changed with no Set-Cookie", async () => {
		const u = await login();
		// Due for a refresh: a matched request would answer with a fresh cookie, so a refused one that does not proves the refusal comes first.
		await ageSession(u.cookie);
		const res = await ping(u.cookie, "some-other-session");
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: "session_changed", error: "The session changed.", level: "info" });
		expect(setsSessionCookie(res)).toBe(false);
		expect(res.headers.get("set-cookie")).toBeNull();
		// Control: the matching id on an aged session does refresh it (the refused request already refreshed the row, so age it again).
		await ageSession(u.cookie);
		expect(setsSessionCookie(await ping(u.cookie, u.sessionId))).toBe(true);
	});

	it("the matching id passes, and so does no id at all", async () => {
		const u = await login();
		expect((await ping(u.cookie, u.sessionId)).status).toBe(200);
		expect((await ping(u.cookie)).status).toBe(200);
	});

	it("no session + an id is 401, not 409", async () => {
		expect((await ping(null, "whatever")).status).toBe(401);
	});

	it("a disabled account + an id is 403, not 409", async () => {
		const u = await login();
		const off = await app.request(`/api/cli/users/${encodeURIComponent(u.email)}/enabled`, { method: "PUT", headers: { ...json, ...cliKey }, body: JSON.stringify({ enabled: false }) }, local);
		expect(off.status).toBe(200);
		const res = await ping(u.cookie, "some-other-session");
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ code: "account_disabled" });
	});

	it("never runs the handler for a stale tab", async () => {
		const u = await login();
		// A destructive write behind authMiddleware: the refused request must change nothing.
		const stale = await app.request("/api/profile", { method: "DELETE", headers: { cookie: u.cookie, "x-session-id": "stale" } }, local);
		expect(stale.status).toBe(409);
		const still = await app.request("/api/auth/get-session", { headers: { cookie: u.cookie } }, local);
		expect(((await still.json()) as { user: { email: string } } | null)?.user.email).toBe(u.email);
		// Control: the same request with the right id does run the handler and deletes the account.
		const ok = await app.request("/api/profile", { method: "DELETE", headers: { cookie: u.cookie, "x-session-id": u.sessionId } }, local);
		expect(ok.status).toBe(200);
		const gone = await app.request("/api/auth/get-session", { headers: { cookie: u.cookie } }, local);
		expect(((await gone.json()) as { user?: unknown } | null)?.user).toBeUndefined();
	});

	it("adds no statement to the success path", async () => {
		const u = await login();
		const count = async (sid?: string) => {
			let statements = 0;
			const spied = new Proxy(env.DB, {
				get(target, prop) {
					const value = Reflect.get(target, prop, target);
					if (prop === "prepare") return (sql: string) => (statements++, target.prepare(sql));
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			expect((await ping(u.cookie, sid, { ...local, DB: spied })).status).toBe(200);
			return statements;
		};
		await count(); // warm: Kysely's one-off introspection
		const without = await count();
		expect(without).toBeGreaterThan(0);
		expect(await count(u.sessionId)).toBe(without);
	});
});

describe("/api/auth/*", () => {
	it("an account-changing route is refused 409 for a stale tab", async () => {
		const u = await login();
		const res = await auth("POST", "update-user", u.cookie, "stale", JSON.stringify({ name: "Nope" }));
		expect(res.status).toBe(409);
		expect(isSessionChangedBody(await res.json())).toBe(true);
		// The matching id and no id both go through.
		expect((await auth("POST", "update-user", u.cookie, u.sessionId, JSON.stringify({ name: "Fine" }))).status).toBe(200);
		expect((await auth("POST", "update-user", u.cookie, undefined, JSON.stringify({ name: "Fine 2" }))).status).toBe(200);
	});

	it("a stale tab cannot list or revoke sessions", async () => {
		const u = await login();
		expect((await auth("GET", "list-sessions", u.cookie, "stale")).status).toBe(409);
		expect((await auth("POST", "revoke-other-sessions", u.cookie, "stale")).status).toBe(409);
		expect((await auth("GET", "list-sessions", u.cookie, u.sessionId)).status).toBe(200);
	});

	it("an account route with no session answers 401, not 409", async () => {
		expect((await auth("POST", "update-user", null, "stale")).status).toBe(401);
	});

	it("get-session with a stale id is 200", async () => {
		const u = await login();
		const res = await auth("GET", "get-session", u.cookie, "stale");
		expect(res.status).toBe(200);
		expect(((await res.json()) as { session: { id: string } }).session.id).toBe(u.sessionId);
	});

	it("sign-out with a stale id is not refused", async () => {
		const u = await login();
		const res = await auth("POST", "sign-out", u.cookie, "stale");
		expect(res.status).not.toBe(409);
		expect(res.status).toBe(200);
	});

	it("sign-in with a stale id is not refused", async () => {
		const u = await login();
		const res = await auth("POST", "sign-in/email", null, "stale", JSON.stringify({ email: u.email, password: "password-123" }));
		expect(res.status).toBe(200);
	});
});

describe("isBindingExemptAuthPath", () => {
	it("exempts exactly the sign-in and recovery family", () => {
		for (const segment of BINDING_EXEMPT_AUTH_SEGMENTS) {
			expect(isBindingExemptAuthPath(`/api/auth/${segment}`), segment).toBe(true);
		}
		expect(isBindingExemptAuthPath("/api/auth/sign-in/email")).toBe(true);
		expect(isBindingExemptAuthPath("/api/auth/callback/google")).toBe(true);
		expect(isBindingExemptAuthPath("/api/auth/reset-password/abc")).toBe(true);
	});
	it("checks everything else", () => {
		for (const p of ["update-user", "change-email", "change-password", "list-sessions", "list-accounts", "revoke-session", "revoke-sessions", "revoke-other-sessions", "delete-user", "unlink-account", "link-social", "set-password", "unknown-thing"]) {
			expect(isBindingExemptAuthPath(`/api/auth/${p}`), p).toBe(false);
		}
		// a prefix of an exempt name is not exempt
		expect(isBindingExemptAuthPath("/api/auth/sign-in-as")).toBe(false);
		expect(isBindingExemptAuthPath("/api/auth/")).toBe(false);
	});
});
