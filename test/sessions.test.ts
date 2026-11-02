import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { createDb } from "../src/worker/db";
import type { UserSession } from "../src/shared/sessions";

// "local" so sign-ins are real (the "test" environment stubs the session).
const local = { ...env, ENVIRONMENT: "local" };
const json = { "content-type": "application/json" };
const cli = (path: string, init: { method?: string; body?: unknown } = {}) =>
	app.request(
		`/api/cli${path}`,
		{ method: init.method ?? "GET", headers: { ...json, "x-api-key": env.CLI_API_KEY as string }, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
		local,
	);

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

let n = 0;
async function newUser() {
	const email = `sessions-${Date.now()}-${n++}@example.com`;
	const created = await cli("/users", { method: "POST", body: { email, password: "password-123" } });
	expect(created.status).toBe(200);
	const { userId } = (await created.json()) as { userId: string };
	/** Signs in from a device and returns a caller for the profile endpoints with that session's cookie. */
	const signIn = async (headers: Record<string, string> = {}) => {
		const res = await app.request("/api/auth/sign-in/email", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ email, password: "password-123" }) }, local);
		expect(res.status).toBe(200);
		const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
		return (path = "", init: { method?: string; env?: object } = {}) =>
			app.request(`/api/profile/sessions${path}`, { method: init.method ?? "GET", headers: { cookie } }, { ...local, ...init.env });
	};
	return { id: userId, email, signIn };
}

const sessionsOf = async (call: Awaited<ReturnType<Awaited<ReturnType<typeof newUser>>["signIn"]>>) =>
	((await (await call()).json()) as { sessions: UserSession[]; total: number }).sessions;

describe("a user's own sessions (profile)", () => {
	it("lists them per device, marks this one and never sends a token", async () => {
		const user = await newUser();
		const desktop = await user.signIn({ "user-agent": CHROME, "CF-Connecting-IP": "203.0.113.5" });
		const phone = await user.signIn({ "user-agent": IPHONE, "CF-Connecting-IP": "203.0.113.6" });

		const body = await (await phone()).text();
		expect(body).not.toContain("token");
		const fromPhone = (JSON.parse(body) as { sessions: UserSession[] }).sessions;
		expect(fromPhone).toHaveLength(2);
		expect(fromPhone.find((s) => s.current)).toMatchObject({ device: "Safari · Mobile", ip: "203.0.113.6", status: "active" });
		expect(fromPhone.find((s) => !s.current)).toMatchObject({ device: "Chrome · Desktop", ip: "203.0.113.5" });
		expect(fromPhone[0].current).toBe(true); // most recently used first

		const fromDesktop = await sessionsOf(desktop);
		expect(fromDesktop.find((s) => s.current)?.device).toBe("Chrome · Desktop");
		expect((await app.request("/api/profile/sessions", {}, local)).status).toBe(401);
	});

	it("takes the country from the sign-in that opened the session", async () => {
		const user = await newUser();
		const call = await user.signIn({ "user-agent": CHROME });
		const [session] = await sessionsOf(call);
		expect(session.country).toBeNull();
		await createDb(local).updateTable("login_events").set({ country: "PT" }).where("session_id", "=", session.id).execute();
		expect((await sessionsOf(call))[0].country).toBe("PT");
	});

	it("ends another device, logged as revoked, but not this one nor someone else's", async () => {
		const user = await newUser();
		const stranger = await newUser();
		const desktop = await user.signIn({ "user-agent": CHROME });
		const phone = await user.signIn({ "user-agent": IPHONE });
		const strangers = await sessionsOf(await stranger.signIn());
		const [thisOne, other] = await sessionsOf(phone);

		const own = await phone(`/${thisOne.id}`, { method: "DELETE" });
		expect(own.status).toBe(400);
		expect(((await own.json()) as { code: string }).code).toBe("current_session");
		expect((await phone(`/${strangers[0].id}`, { method: "DELETE" })).status).toBe(404);
		expect((await phone("/nope", { method: "DELETE" })).status).toBe(404);

		expect((await phone(`/${other.id}`, { method: "DELETE" })).status).toBe(204);
		expect((await sessionsOf(phone)).map((s) => s.id)).toEqual([thisOne.id]);
		// The desktop's cookie no longer works.
		expect((await desktop()).status).toBe(401);
		const event = await createDb(local).selectFrom("login_events").select(["user_id", "actor_id"]).where("session_id", "=", other.id).where("event", "=", "session-revoked").executeTakeFirst();
		expect(event).toEqual({ user_id: user.id, actor_id: null });
		// The stranger kept theirs.
		expect(await createDb(local).selectFrom("sessions").select("id").where("id", "=", strangers[0].id).executeTakeFirst()).toBeDefined();
	});

	it("signs out of every other device and keeps this one", async () => {
		const user = await newUser();
		await user.signIn({ "user-agent": CHROME });
		await user.signIn({ "user-agent": CHROME });
		const phone = await user.signIn({ "user-agent": IPHONE });
		const ended = await phone("/sign-out-others", { method: "POST" });
		expect(await ended.json()).toEqual({ ended: 2 });
		const left = await sessionsOf(phone);
		expect(left).toHaveLength(1);
		expect(left[0].current).toBe(true);
		const revoked = await createDb(local).selectFrom("login_events").select("id").where("user_id", "=", user.id).where("event", "=", "session-revoked").execute();
		expect(revoked).toHaveLength(2);
	});

	it("in a demo masks the addresses and refuses every write", async () => {
		const user = await newUser();
		await user.signIn({ "CF-Connecting-IP": "203.0.113.5" });
		const phone = await user.signIn({ "user-agent": IPHONE, "CF-Connecting-IP": "203.0.113.6" });
		const demo = { DEMO_MODE: "1" };
		const listed = (await (await phone("", { env: demo })).json()) as { sessions: UserSession[] };
		expect(listed.sessions.map((s) => s.ip).sort()).toEqual(["203.0.113.x", "203.0.113.x"]);
		expect((await phone(`/${listed.sessions[1].id}`, { method: "DELETE", env: demo })).status).toBe(403);
		expect((await phone("/sign-out-others", { method: "POST", env: demo })).status).toBe(403);
		expect(await sessionsOf(phone)).toHaveLength(2);
	});
});

describe("auth CLI: sessions per device", () => {
	it("lists a user's sessions in show-user and on their own endpoint", async () => {
		const user = await newUser();
		await user.signIn({ "user-agent": CHROME, "CF-Connecting-IP": "203.0.113.5" });
		await user.signIn({ "user-agent": IPHONE, "CF-Connecting-IP": "203.0.113.6" });

		const shown = (await (await cli(`/users/${user.email}`)).json()) as { activeSessions: number; sessions: UserSession[] };
		expect(shown.activeSessions).toBe(2);
		expect(shown.sessions.map((s) => s.device).sort()).toEqual(["Chrome · Desktop", "Safari · Mobile"]);
		// The CLI sees real addresses (it holds the API key), but never a token.
		expect(shown.sessions.map((s) => s.ip).sort()).toEqual(["203.0.113.5", "203.0.113.6"]);
		const listed = await (await cli(`/users/${user.email}/sessions`)).text();
		expect(listed).not.toContain("token");
		expect((JSON.parse(listed) as { sessions: unknown[] }).sessions).toHaveLength(2);
		expect((await cli("/users/nobody@example.com/sessions")).status).toBe(404);
	});

	it("ends one session by id or by its start, logged as revoked, and refuses another user's", async () => {
		const user = await newUser();
		const stranger = await newUser();
		const phone = await user.signIn({ "user-agent": IPHONE });
		await user.signIn({ "user-agent": CHROME });
		const strangers = await sessionsOf(await stranger.signIn());
		const [first, second] = await sessionsOf(phone);

		// Another user's session, a session that does not exist, and a prefix too short to name one.
		expect((await cli(`/users/${user.email}/sessions/${strangers[0].id}/sign-out`, { method: "POST" })).status).toBe(404);
		expect((await cli(`/users/${user.email}/sessions/nope/sign-out`, { method: "POST" })).status).toBe(404);
		expect((await cli(`/users/${user.email}/sessions/${first.id.slice(0, 2)}/sign-out`, { method: "POST" })).status).toBe(404);
		expect((await cli(`/users/nobody@example.com/sessions/${first.id}/sign-out`, { method: "POST" })).status).toBe(404);
		expect(await sessionsOf(phone)).toHaveLength(2);

		const byPrefix = await cli(`/users/${user.email}/sessions/${first.id.slice(0, 8)}/sign-out`, { method: "POST" });
		expect(byPrefix.status).toBe(200);
		expect(await byPrefix.json()).toMatchObject({ success: true, sessionId: first.id });
		const byId = await cli(`/users/${user.email}/sessions/${second.id}/sign-out`, { method: "POST" });
		expect(byId.status).toBe(200);

		const events = await createDb(local).selectFrom("login_events").select(["session_id", "actor_id"]).where("user_id", "=", user.id).where("event", "=", "session-revoked").execute();
		expect(events.map((e) => e.session_id).sort()).toEqual([first.id, second.id].sort());
		expect(events.every((e) => e.actor_id === null)).toBe(true);
		// The stranger kept theirs.
		expect(await createDb(local).selectFrom("sessions").select("id").where("id", "=", strangers[0].id).executeTakeFirst()).toBeDefined();
		// Without the API key none of it is reachable.
		expect((await app.request(`/api/cli/users/${user.email}/sessions`, {}, local)).status).toBe(401);
	});
});
