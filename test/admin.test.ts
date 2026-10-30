import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { pruneExpiredAuthRows } from "../src/worker/lib/expired-auth-rows";
import { createDb } from "../src/worker/db";
import { describeBrowser } from "../src/shared/admin-users";

// The "test" environment stubs the session with a fixed user; the admin area
// is about roles, so these run with real sign-ins ("local" keeps everything else as in dev).
const local = { ...env, ENVIRONMENT: "local" };
const json = { "content-type": "application/json" };
const cliKey = { "x-api-key": env.CLI_API_KEY as string };

let n = 0;
async function userWithRole(role: string) {
	const email = `admin-test-${Date.now()}-${n++}@example.com`;
	const password = "password-123";
	const res = await app.request("/api/cli/users", { method: "POST", headers: { ...json, ...cliKey }, body: JSON.stringify({ email, password, name: role, role }) }, local);
	expect(res.status).toBeLessThan(300);
	const { userId } = (await res.json()) as { userId: string };
	const signIn = await app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password }) }, local);
	expect(signIn.status).toBe(200);
	const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
	const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
		app.request(`/api/admin${path}`, { method: init.method ?? "GET", headers: { ...json, cookie }, body: init.body === undefined ? undefined : JSON.stringify(init.body) }, local);
	return { id: userId, email, call };
}

describe("admin API", () => {
	it("needs a session, then admin or higher, and superadmin for users", async () => {
		expect((await app.request("/api/admin/users", {}, local)).status).toBe(401);
		const user = await userWithRole("user");
		const admin = await userWithRole("admin");
		const superadmin = await userWithRole("superadmin");
		expect((await user.call("/users")).status).toBe(403);
		expect((await user.call("/anything")).status).toBe(403);
		expect((await admin.call("/users")).status).toBe(403);
		expect((await admin.call("/anything")).status).toBe(404);
		expect((await superadmin.call("/users")).status).toBe(200);
	});

	it("the session carries the role", async () => {
		const admin = await userWithRole("admin");
		const res = await app.request("/api/auth/get-session", { headers: { cookie: (await signInCookie(admin.email)) } }, local);
		expect(((await res.json()) as { user: { role: string } }).user.role).toBe("admin");
	});

	it("creates, lists, reads, updates and deletes a user", async () => {
		const { call } = await userWithRole("superadmin");
		const email = `crud-${Date.now()}@example.com`;

		const bad = await call("/users", { method: "POST", body: { name: "", email: "nope", role: "user", enabled: true, emailVerified: true, password: "short" } });
		expect(bad.status).toBe(400);

		const created = await call("/users", { method: "POST", body: { name: "Crud", email: email.toUpperCase(), role: "user", enabled: true, emailVerified: true, password: "password-123" } });
		expect(created.status).toBe(201);
		const { id, email: stored } = (await created.json()) as { id: string; email: string };
		expect(stored).toBe(email);
		expect((await call("/users", { method: "POST", body: { name: "", email, role: "user", enabled: true, emailVerified: true, password: "password-123" } })).status).toBe(409);

		const list = (await (await call(`/users?q=${encodeURIComponent(email)}`)).json()) as { users: { id: string }[]; total: number };
		expect(list.total).toBe(1);
		expect(list.users[0].id).toBe(id);

		const detail = (await (await call(`/users/${id}`)).json()) as { signInMethods: string[] };
		expect(detail.signInMethods).toEqual(["credential"]);

		const updated = await call(`/users/${id}`, { method: "PATCH", body: { name: "Renamed", role: "admin" } });
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({ name: "Renamed", role: "admin" });

		expect((await call(`/users/${id}`, { method: "DELETE" })).status).toBe(204);
		expect((await call(`/users/${id}`)).status).toBe(404);
	});

	it("a superadmin cannot demote, deactivate or delete themselves", async () => {
		const me = await userWithRole("superadmin");
		expect((await me.call(`/users/${me.id}`, { method: "PATCH", body: { role: "user" } })).status).toBe(403);
		expect((await me.call(`/users/${me.id}`, { method: "PATCH", body: { enabled: false } })).status).toBe(403);
		expect((await me.call(`/users/${me.id}`, { method: "DELETE" })).status).toBe(403);
		expect((await me.call(`/users/${me.id}`, { method: "PATCH", body: { name: "Still me" } })).status).toBe(200);
	});

	it("a demoted user loses their sessions", async () => {
		const { call } = await userWithRole("superadmin");
		const target = await userWithRole("admin");
		expect((await target.call("/anything")).status).toBe(404);
		expect((await call(`/users/${target.id}`, { method: "PATCH", body: { role: "user" } })).status).toBe(200);
		expect((await target.call("/anything")).status).toBe(401);
	});

	it("shows who is in session, and logs sign-ins and sign-outs", async () => {
		const { call } = await userWithRole("superadmin");
		const target = await userWithRole("user");
		type Row = { id: string; status: string; idleSeconds: number | null };
		const find = async () => ((await (await call(`/users?q=${encodeURIComponent(target.email)}`)).json()) as { users: Row[] }).users[0];

		// Signed in just now: in session and active.
		const active = await find();
		expect(active.status).toBe("active");
		expect(active.idleSeconds).toBeLessThan(300);

		// Disabling ends the sessions and wins over everything else; a disabled user cannot sign in.
		await call(`/users/${target.id}`, { method: "PATCH", body: { enabled: false } });
		expect((await find()).status).toBe("disabled");
		const refused = await app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email: target.email, password: "password-123" }) }, local);
		expect(refused.status).toBeGreaterThanOrEqual(400);
		// Sorted by status, a disabled user comes after the active ones ascending, and first descending.
		const byStatus = async (dir: string) =>
			((await (await call(`/users?sort=status&dir=${dir}&pageSize=100`)).json()) as { users: Row[] }).users.map((u) => u.status);
		const asc = await byStatus("asc");
		expect(asc.indexOf("active")).toBeLessThan(asc.indexOf("disabled"));
		expect((await byStatus("desc"))[0]).toBe("disabled");
		await call(`/users/${target.id}`, { method: "PATCH", body: { enabled: true } });

		// Without a session, an unconfirmed address shows as unverified.
		await call(`/users/${target.id}`, { method: "PATCH", body: { emailVerified: false } });
		expect((await find()).status).toBe("unverified");
		await call(`/users/${target.id}`, { method: "PATCH", body: { emailVerified: true } });

		// Sign-in with a wrong password is a failure; signing out is recorded.
		await app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email: target.email, password: "wrong-password" }) }, local);
		const signOut = await app.request(
			"/api/auth/sign-out",
			{ method: "POST", headers: { ...json, cookie: await signInCookie(target.email), origin: new URL(local.APP_BASE_URL as string).origin }, body: "{}" },
			local,
		);
		expect(signOut.status).toBe(200);

		const activity = (await (await call(`/users/${target.id}/activity`)).json()) as { events: { kind: string }[] };
		const kinds = activity.events.map((e) => e.kind);
		expect(kinds).toContain("sign-in");
		expect(kinds).toContain("sign-out");
		expect(kinds).toContain("failed");

		// Sorted by event, ascending and descending; the count is in the detail.
		const sortedKinds = async (dir: string) =>
			((await (await call(`/users/${target.id}/activity?sort=kind&dir=${dir}`)).json()) as { events: { kind: string }[] }).events.map((e) => e.kind);
		expect(await sortedKinds("asc")).toEqual([...kinds].sort());
		expect(await sortedKinds("desc")).toEqual([...kinds].sort().reverse());

		const row = await find();
		expect((row as Row & { lastSignInAt: string | null }).lastSignInAt).not.toBeNull();
		const detail = (await (await call(`/users/${target.id}`)).json()) as { lastSignOutAt: string | null; activityCount: number; signIns: number; failedSignIns: number };
		expect(detail.lastSignOutAt).not.toBeNull();
		expect(detail.activityCount).toBe(kinds.length);
		// The totals follow the log: two sign-ins (setup and before the sign-out), two failures (wrong password, disabled).
		expect(detail.signIns).toBe(2);
		expect(detail.failedSignIns).toBe(2);
		const signOutEvent = (await (await call(`/users/${target.id}/activity`)).json()) as { events: { kind: string; method: string | null; durationSeconds: number | null }[] };
		expect(signOutEvent.events.find((e) => e.kind === "sign-out")?.durationSeconds).not.toBeNull();
		expect(signOutEvent.events.find((e) => e.kind === "sign-in")?.method).toBe("password");

		// Sorted by idle time, users without a session come last in either direction.
		for (const dir of ["asc", "desc"]) {
			const users = ((await (await call(`/users?sort=idleSeconds&dir=${dir}&pageSize=100`)).json()) as { users: Row[] }).users;
			const idle = users.map((u) => (u as Row & { idleSeconds: number | null }).idleSeconds);
			expect(idle.slice(idle.findIndex((v) => v === null)).every((v) => v === null)).toBe(true);
		}
	});
});

describe("session endings in the log", () => {
	it("records the deletion of a user, and who deleted them", async () => {
		const admin = await userWithRole("superadmin");
		const target = await userWithRole("user");
		expect((await admin.call(`/users/${target.id}`, { method: "DELETE" })).status).toBe(204);
		const db = createDb(local);
		const event = await db.selectFrom("login_events").select(["email", "actor_id"]).where("user_id", "=", target.id).where("event", "=", "user-deleted").executeTakeFirst();
		expect(event?.email).toBe(target.email);
		expect(event?.actor_id).toBe(admin.id);
		// The totals outlive the account.
		expect((await db.selectFrom("user_stats").select("sign_ins").where("user_id", "=", target.id).executeTakeFirst())?.sign_ins).toBe(1);
	});

	it("records revoked and expired sessions", async () => {
		const { call } = await userWithRole("superadmin");
		const target = await userWithRole("user");
		const kinds = async () => ((await (await call(`/users/${target.id}/activity`)).json()) as { events: { kind: string }[] }).events.map((e) => e.kind);

		// An admin setting a password signs the user out everywhere: their session is revoked.
		expect((await call(`/users/${target.id}`, { method: "PATCH", body: { password: "new-password-123" } })).status).toBe(200);
		expect(await kinds()).toContain("session-revoked");

		// The detail says where the live session comes from; "sign out everywhere" ends it and records it.
		await signInCookie(target.email, "new-password-123");
		const detail = (await (await call(`/users/${target.id}`)).json()) as { currentSession: unknown; activeSessions: number };
		expect(detail.currentSession).not.toBeNull();
		expect((await call(`/users/${target.id}/sign-out`, { method: "POST" })).status).toBe(204);
		expect(((await (await call(`/users/${target.id}`)).json()) as { activeSessions: number }).activeSessions).toBe(0);

		// A session past its expiry is recorded by the cron before it is deleted.
		await signInCookie(target.email, "new-password-123");
		const db = createDb(local);
		await db.updateTable("sessions").set({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).where("userId", "=", target.id).execute();
		await pruneExpiredAuthRows(local);
		expect(await kinds()).toContain("session-expired");
	});
});

describe("describeBrowser", () => {
	it("names the browser and the kind of device", () => {
		const ua = {
			chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
			edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
			safariPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
			firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0",
			chromeTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
		};
		expect(describeBrowser(ua.chrome)).toBe("Chrome · Desktop");
		expect(describeBrowser(ua.edge)).toBe("Edge · Desktop");
		expect(describeBrowser(ua.safariPhone)).toBe("Safari · Mobile");
		expect(describeBrowser(ua.firefoxAndroid)).toBe("Firefox · Mobile");
		expect(describeBrowser(ua.chromeTablet)).toBe("Chrome · Tablet");
		expect(describeBrowser("curl/8.7.1")).toBe("curl/8.7.1");
		expect(describeBrowser(null)).toBe("—");
	});
});

async function signInCookie(email: string, password = "password-123") {
	const res = await app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password }) }, local);
	return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
