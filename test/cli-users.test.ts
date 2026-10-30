import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";

// "local" so sign-ins are real (the "test" environment stubs the session).
const local = { ...env, ENVIRONMENT: "local" };
const json = { "content-type": "application/json" };
const cli = (path: string, init: { method?: string; body?: unknown } = {}) =>
	app.request(
		`/api/cli${path}`,
		{ method: init.method ?? "GET", headers: { ...json, "x-api-key": env.CLI_API_KEY as string }, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
		local,
	);
const signIn = (email: string, password = "password-123") =>
	app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password }) }, local);

describe("auth CLI: user state and history", () => {
	it("creates a disabled user, who cannot sign in until enabled", async () => {
		const email = `cli-disabled-${Date.now()}@example.com`;
		expect((await cli("/users", { method: "POST", body: { email, password: "password-123", enabled: false } })).status).toBe(200);
		expect((await signIn(email)).status).toBe(403);

		const shown = (await (await cli(`/users/${email}`)).json()) as { user: { enabled: boolean; status: string; failedSignIns: number } };
		expect(shown.user).toMatchObject({ enabled: false, status: "disabled", failedSignIns: 1 });

		expect((await cli(`/users/${email}/enabled`, { method: "PUT", body: { enabled: true } })).status).toBe(200);
		expect((await signIn(email)).status).toBe(200);
	});

	it("shows a user's usage, signs them out everywhere and lists their history", async () => {
		const email = `cli-usage-${Date.now()}@example.com`;
		await cli("/users", { method: "POST", body: { email, password: "password-123" } });
		await signIn(email);
		await signIn(email);

		const shown = (await (await cli(`/users/${email}`)).json()) as {
			user: { status: string; signIns: number; lastSignInAt: string | null };
			signInMethods: string[];
			activeSessions: number;
			currentSession: unknown;
		};
		expect(shown.user).toMatchObject({ status: "active", signIns: 2 });
		expect(shown.user.lastSignInAt).not.toBeNull();
		expect(shown.signInMethods).toEqual(["credential"]);
		expect(shown.activeSessions).toBe(2);
		expect(shown.currentSession).not.toBeNull();

		const listed = (await (await cli(`/users?search=${email}`)).json()) as { users: { email: string; signIns: number }[] };
		expect(listed.users).toEqual([expect.objectContaining({ email, signIns: 2 })]);

		const out = (await (await cli(`/users/${email}/sign-out`, { method: "POST" })).json()) as { sessions: number };
		expect(out.sessions).toBe(2);

		const { events } = (await (await cli(`/users/${email}/activity?limit=10`)).json()) as { events: { kind: string; method: string | null }[] };
		expect(events.map((e) => e.kind)).toEqual(["session-revoked", "session-revoked", "sign-in", "sign-in"]);
		expect(events[3].method).toBe("password");
	});

	it("rejects an unknown user and a malformed switch", async () => {
		expect((await cli("/users/nobody@example.com/enabled", { method: "PUT", body: { enabled: false } })).status).toBe(404);
		expect((await cli("/users/nobody@example.com/activity")).status).toBe(404);
		expect((await cli("/users/x@example.com/enabled", { method: "PUT", body: { enabled: "no" } })).status).toBe(400);
	});

	it("a new password signs the user out everywhere", async () => {
		const email = `cli-pass-${Date.now()}@example.com`;
		await cli("/users", { method: "POST", body: { email, password: "password-123" } });
		await signIn(email);
		expect((await cli(`/users/${email}/password`, { method: "PUT", body: { password: "another-pass-1" } })).status).toBe(200);
		expect((await signIn(email, "another-pass-1")).status).toBe(200);
		const shown = (await (await cli(`/users/${email}`)).json()) as { activeSessions: number };
		expect(shown.activeSessions).toBe(1);
	});
});
