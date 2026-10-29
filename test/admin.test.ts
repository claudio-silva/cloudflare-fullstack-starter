import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
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

		const bad = await call("/users", { method: "POST", body: { name: "", email: "nope", role: "user", emailVerified: true, password: "short" } });
		expect(bad.status).toBe(400);

		const created = await call("/users", { method: "POST", body: { name: "Crud", email: email.toUpperCase(), role: "user", emailVerified: true, password: "password-123" } });
		expect(created.status).toBe(201);
		const { id, email: stored } = (await created.json()) as { id: string; email: string };
		expect(stored).toBe(email);
		expect((await call("/users", { method: "POST", body: { name: "", email, role: "user", emailVerified: true, password: "password-123" } })).status).toBe(409);

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
		expect((await me.call(`/users/${me.id}`, { method: "PATCH", body: { emailVerified: false } })).status).toBe(403);
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

		// Disabled takes precedence over the session.
		await call(`/users/${target.id}`, { method: "PATCH", body: { emailVerified: false } });
		expect((await find()).status).toBe("disabled");
		// Sorted by status, a disabled user comes after the active ones ascending, and first descending.
		const byStatus = async (dir: string) =>
			((await (await call(`/users?sort=status&dir=${dir}&pageSize=100`)).json()) as { users: Row[] }).users.map((u) => u.status);
		const asc = await byStatus("asc");
		expect(asc.indexOf("active")).toBeLessThan(asc.indexOf("disabled"));
		expect((await byStatus("desc"))[0]).toBe("disabled");
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

		const row = await find();
		expect((row as Row & { lastSignInAt: string | null }).lastSignInAt).not.toBeNull();
		const detail = (await (await call(`/users/${target.id}`)).json()) as { lastSignOutAt: string | null };
		expect(detail.lastSignOutAt).not.toBeNull();
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

async function signInCookie(email: string) {
	const res = await app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password: "password-123" }) }, local);
	return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
