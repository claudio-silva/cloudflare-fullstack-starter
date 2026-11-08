import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { createDb, dbBool, dbTime } from "../src/worker/db";
import { authMiddleware } from "../src/worker/middleware/auth";
import { background } from "../src/worker/lib/route-kind";
import { sessionTokenFromHeaders } from "../src/worker/lib/session-revocations";
import { config } from "../src/config";
import type { AppBindings } from "../src/worker/types/context";

// "local" so sign-ins are real (the "test" environment stubs the session).
const local = { ...env, ENVIRONMENT: "local" };
const json = { "content-type": "application/json" };
const cliKey = { "x-api-key": env.CLI_API_KEY as string };

// The starter's authMiddleware on a normal and a background route.
const probe = new Hono<AppBindings>();
probe.get("/api/__normal", authMiddleware, (c) => c.json({ ok: true }));
probe.get("/api/__bg", background, authMiddleware, (c) => c.json({ ok: true }));
// The same background route inside a sub-app with its own onError, where Hono hides the marker from matchedRoutes.
const sub = new Hono<AppBindings>();
sub.onError((err, c) => c.text(err.message, 500));
sub.get("/__bg", background, authMiddleware, (c) => c.json({ ok: true }));
probe.route("/api/__sub", sub);
const hit = (path: string, cookie: string | null) => probe.request(path, { headers: cookie ? { cookie } : {} }, local);

let n = 0;
async function signedIn() {
	const email = `refresh-${Date.now()}-${n++}@example.com`;
	const created = await app.request("/api/cli/users", { method: "POST", headers: { ...json, ...cliKey }, body: JSON.stringify({ email, password: "password-123", role: "user" }) }, local);
	expect(created.status).toBe(200);
	const res = await app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password: "password-123" }) }, local);
	expect(res.status).toBe(200);
	const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
	return { cookie, token: sessionTokenFromHeaders(new Headers({ cookie }))! };
}

const db = createDb(local);
const row = (token: string) => db.selectFrom("sessions").select(["expiresAt", "updatedAt", "createdAt"]).where("token", "=", token).executeTakeFirstOrThrow();
const ms = (t: Date | string) => new Date(t).getTime();
/** Makes the session look last used (and due to expire) two minutes earlier than it is. */
async function rewind(token: string) {
	const r = await row(token);
	await db.updateTable("sessions").set({ updatedAt: dbTime(new Date(ms(r.updatedAt) - 120_000)), expiresAt: dbTime(new Date(ms(r.expiresAt) - 120_000)) }).where("token", "=", token).execute();
	return row(token);
}

describe("session refresh", () => {
	it("takes the session lifetime from config", async () => {
		const { token } = await signedIn();
		const r = await row(token);
		const seconds = (ms(r.expiresAt) - ms(r.createdAt)) / 1000;
		expect(config.auth.session.idleTimeoutSeconds).toBe(43200);
		expect(Math.abs(seconds - config.auth.session.idleTimeoutSeconds)).toBeLessThanOrEqual(5);
	});

	it("a normal request pushes the expiry forward and sets the cookie", async () => {
		const { cookie, token } = await signedIn();
		const before = await rewind(token);
		const res = await hit("/api/__normal", cookie);
		expect(res.status).toBe(200);
		expect(ms((await row(token)).expiresAt)).toBeGreaterThan(ms(before.expiresAt) + 60_000);
		expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
	});

	it("a background request leaves the expiry alone", async () => {
		const { cookie, token } = await signedIn();
		const before = await rewind(token);
		const res = await hit("/api/__bg", cookie);
		expect(res.status).toBe(200);
		expect(ms((await row(token)).expiresAt)).toBe(ms(before.expiresAt));
		expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(false);
	});

	it("a background route in a sub-app with its own onError is still background (the marker listed before authMiddleware)", async () => {
		const { cookie, token } = await signedIn();
		const before = await rewind(token);
		const res = await hit("/api/__sub/__bg", cookie);
		expect(res.status).toBe(200);
		expect(ms((await row(token)).expiresAt)).toBe(ms(before.expiresAt));
		expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(false);
	});

	it("a denied request carries no Set-Cookie", async () => {
		// The cookie of a session whose row is gone: Better Auth answers by clearing it. A request with no
		// cookie at all would never have a Set-Cookie to forward, so it could not tell the gate from its absence.
		const { cookie, token } = await signedIn();
		await db.deleteFrom("sessions").where("token", "=", token).execute();
		const underlying = await app.request("/api/auth/get-session", { headers: { cookie } }, local);
		expect(underlying.headers.getSetCookie().length, "Better Auth does write a clearing cookie here").toBeGreaterThan(0);

		const res = await hit("/api/__normal", cookie);
		expect(res.status).toBe(401);
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	it("a request refused by the disabled gate carries no refresh cookie", async () => {
		const { cookie, token } = await signedIn();
		await rewind(token); // due for a refresh, so Better Auth would set a cookie
		// Disable the user without ending the session, so the request reaches the gate with a live session.
		await db.updateTable("users").set({ disabled: dbBool(true) }).where("id", "=", (await db.selectFrom("sessions").select("userId").where("token", "=", token).executeTakeFirstOrThrow()).userId).execute();
		const res = await hit("/api/__normal", cookie);
		expect(res.status).toBe(403);
		expect(res.headers.get("set-cookie")).toBeNull();
	});
});
