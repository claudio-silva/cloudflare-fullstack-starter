import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { createDb } from "../src/worker/db";
import { isAccountDisabledBody } from "../src/shared/account-status";
import { signInWithDisabledGuard } from "../src/worker/lib/sign-in-guard";

/**
 * A wrong password never reveals a disabled account: it gets the answer any account gets. Only a
 * correct password on a disabled account is 403 `account_disabled`, without a session or a cookie.
 */

const local = { ...env, ENVIRONMENT: "local" };
const json = { "content-type": "application/json" };
const cliKey = { "x-api-key": env.CLI_API_KEY as string };

let n = 0;
async function newUser(enabled = true) {
	const email = `guard-${Date.now()}-${n++}@example.com`;
	const res = await app.request("/api/cli/users", { method: "POST", headers: { ...json, ...cliKey }, body: JSON.stringify({ email, password: "password-123", role: "user" }) }, local);
	const { userId } = (await res.json()) as { userId: string };
	if (!enabled) await app.request(`/api/cli/users/${encodeURIComponent(email)}/enabled`, { method: "PUT", headers: { ...json, ...cliKey }, body: JSON.stringify({ enabled: false }) }, local);
	return { id: userId, email };
}
const signIn = (email: string, password: string) =>
	app.request("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password }) }, local);
const sessionCount = async (userId: string) => (await createDb(local).selectFrom("sessions").select("id").where("userId", "=", userId).execute()).length;
const failures = async (userId: string) => (await createDb(local).selectFrom("login_events").select(["success", "event"]).where("user_id", "=", userId).execute()).filter((r) => !r.success && r.event === "sign-in").length;

describe("sign-in on a disabled account (the password is checked first)", () => {
	it("wrong password: the same status and code as for an enabled account, never 403", async () => {
		const enabled = await newUser();
		const disabled = await newUser(false);
		const a = await signIn(enabled.email, "wrong-password");
		const b = await signIn(disabled.email, "wrong-password");
		expect(b.status).not.toBe(403);
		expect(b.status).toBe(a.status);
		const bodyA = (await a.json()) as { code?: string };
		const bodyB = (await b.json()) as { code?: string };
		expect(bodyB.code).toBe(bodyA.code);
		expect(isAccountDisabledBody(bodyB)).toBe(false);
		expect(await sessionCount(disabled.id)).toBe(0);
	});

	it("correct password: 403 account_disabled, no session, no Set-Cookie, a failed sign-in recorded", async () => {
		const u = await newUser(false);
		const res = await signIn(u.email, "password-123");
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ code: "account_disabled", level: "info" });
		expect(res.headers.getSetCookie()).toEqual([]);
		expect(await sessionCount(u.id)).toBe(0);
		expect(await failures(u.id)).toBe(1);
	});

	it("an ordinary wrong password is still recorded as a failure", async () => {
		const u = await newUser(false);
		await signIn(u.email, "wrong-password");
		expect(await failures(u.id)).toBe(1);
	});

	it("enabled account, correct password: unchanged success with a session cookie", async () => {
		const u = await newUser();
		const res = await signIn(u.email, "password-123");
		expect(res.status).toBe(200);
		expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
		expect(await sessionCount(u.id)).toBe(1);
	});

	it("unknown email: Better Auth's own answer, unchanged", async () => {
		const res = await signIn(`nobody-${Date.now()}@example.com`, "password-123");
		expect(res.status).toBe(401);
		expect(isAccountDisabledBody(await res.json())).toBe(false);
	});
});

describe("signInWithDisabledGuard", () => {
	const request = () => new Request("http://x/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: " A@X.com " }) });
	const refuse = () => new Response("disabled", { status: 403 });
	it("passes any other failure through, without looking the email up", async () => {
		let looked = false;
		const wrong = Response.json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 });
		const out = await signInWithDisabledGuard(request(), async () => wrong, async () => ((looked = true), true), refuse);
		expect(out).toBe(wrong);
		expect(looked).toBe(false);
	});
	it("a refused session on a disabled email is the refusal; on an enabled email it stays Better Auth's answer", async () => {
		const refused = () => Response.json({ code: "FAILED_TO_CREATE_SESSION" }, { status: 401, headers: { "set-cookie": "a=b" } });
		const asked: string[] = [];
		const disabled = await signInWithDisabledGuard(request(), async () => refused(), async (e) => (asked.push(e), true), refuse);
		expect(disabled.status).toBe(403);
		expect(disabled.headers.get("set-cookie")).toBeNull();
		expect(asked).toEqual(["a@x.com"]);
		expect((await signInWithDisabledGuard(request(), async () => refused(), async () => false, refuse)).status).toBe(401);
	});
});
