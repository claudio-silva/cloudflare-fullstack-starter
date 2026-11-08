import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";
import { createDb } from "../src/worker/db";
import { isAccountDisabledBody } from "../src/shared/account-status";
import { createEmailVerificationToken } from "better-auth/api";
import { isSessionCreatingAuthRequest, signInWithDisabledGuard } from "../src/worker/lib/sign-in-guard";

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
		const bodyA = (await a.json()) as { code?: string; message?: string };
		const bodyB = (await b.json()) as { code?: string; message?: string };
		expect(bodyB.code).toBe(bodyA.code);
		expect(bodyB.message).toBe(bodyA.message);
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

describe("email verification with auto sign-in (the verify step creates a session)", () => {
	const secret = (env as unknown as Record<string, string | undefined>).BETTER_AUTH_SECRET ?? "better-auth-secret-12345678901234567890";
	async function unverified(enabled: boolean) {
		const u = await newUser(enabled);
		await createDb(local).updateTable("users").set({ emailVerified: 0 }).where("id", "=", u.id).execute();
		return { ...u, token: await createEmailVerificationToken(secret, u.email) };
	}
	const verify = (token: string) => app.request(`/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=/`, {}, local);

	it("an enabled account is verified, signed in and redirected, unchanged", async () => {
		const u = await unverified(true);
		const res = await verify(u.token);
		expect(res.status).toBe(302);
		expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
		expect(await sessionCount(u.id)).toBe(1);
	});
	it("a disabled account gets 403 account_disabled (the app's HTTP layer then leaves for /account-disabled), no session, no cookie", async () => {
		const u = await unverified(false);
		const res = await verify(u.token);
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ code: "account_disabled" });
		expect(res.headers.getSetCookie()).toEqual([]);
		expect(await sessionCount(u.id)).toBe(0);
	});
	it("a bad token is still Better Auth's own answer", async () => {
		const res = await verify("not-a-token");
		expect(isAccountDisabledBody(await res.clone().json().catch(() => null))).toBe(false);
	});
});

describe("signInWithDisabledGuard", () => {
	const request = () => new Request("http://x/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: "a@x.com" }) });
	const refuse = () => new Response("disabled", { status: 403 });
	const refusedJson = () => Response.json({ code: "FAILED_TO_CREATE_SESSION" }, { status: 401, headers: { "set-cookie": "a=b" } });
	const redirect = (location: string) => new Response(null, { status: 302, headers: { location, "set-cookie": "better-auth.state=; Max-Age=0" } });

	it("passes any other failure through, even when the hook flagged a refusal elsewhere never happened", async () => {
		const wrong = Response.json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 });
		expect(await signInWithDisabledGuard(request(), async () => wrong, () => false, refuse)).toBe(wrong);
	});
	it("the same failure without the hook's flag stays Better Auth's answer", async () => {
		expect((await signInWithDisabledGuard(request(), async () => refusedJson(), () => false, refuse)).status).toBe(401);
	});
	it("the flag is read after the handler ran, and a refused JSON route is the refusal with no cookie", async () => {
		let flagged = false;
		const out = await signInWithDisabledGuard(request(), async () => ((flagged = true), refusedJson()), () => flagged, refuse);
		expect(out.status).toBe(403);
		expect(out.headers.get("set-cookie")).toBeNull();
	});
	it("a refused OAuth callback goes to the account-disabled page, keeping the state-cookie deletion", async () => {
		const out = await signInWithDisabledGuard(request(), async () => redirect("http://app.test/some/page?x=1&error=unable_to_create_session"), () => true, refuse);
		expect(out.status).toBe(302);
		expect(out.headers.get("location")).toBe("/account-disabled");
		expect(out.headers.getSetCookie()).toEqual(["better-auth.state=; Max-Age=0"]);
	});
	it("a refusal whose error URL is the re-login completion page goes there with error=account_disabled", async () => {
		const out = await signInWithDisabledGuard(request(), async () => redirect("/auth/reauth-complete?error=1&error=unable_to_create_session"), () => true, refuse);
		expect(out.headers.get("location")).toBe("/auth/reauth-complete?error=account_disabled");
	});
	it("a redirect with another error, or without the flag, is untouched", async () => {
		const other = redirect("/auth/reauth-complete?error=access_denied");
		expect(await signInWithDisabledGuard(request(), async () => other, () => true, refuse)).toBe(other);
		const unflagged = redirect("/x?error=unable_to_create_session");
		expect(await signInWithDisabledGuard(request(), async () => unflagged, () => false, refuse)).toBe(unflagged);
	});
	it("a refused social idToken sign-in (JSON OAUTH_LINK_ERROR) is the refusal", async () => {
		const out = await signInWithDisabledGuard(request(), async () => Response.json({ code: "OAUTH_LINK_ERROR", message: "unable to create session" }, { status: 401 }), () => true, refuse);
		expect(out.status).toBe(403);
	});
});

describe("isSessionCreatingAuthRequest", () => {
	it("covers every route that can create a session, and no other", () => {
		expect(isSessionCreatingAuthRequest("POST", "/api/auth/sign-in/email")).toBe(true);
		expect(isSessionCreatingAuthRequest("POST", "/api/auth/sign-in/social")).toBe(true);
		expect(isSessionCreatingAuthRequest("GET", "/api/auth/callback/google")).toBe(true);
		expect(isSessionCreatingAuthRequest("GET", "/api/auth/verify-email")).toBe(true);
		expect(isSessionCreatingAuthRequest("GET", "/api/auth/magic-link/verify")).toBe(true);
		expect(isSessionCreatingAuthRequest("GET", "/api/auth/get-session")).toBe(false);
		expect(isSessionCreatingAuthRequest("POST", "/api/auth/sign-out")).toBe(false);
		expect(isSessionCreatingAuthRequest("POST", "/api/auth/sign-up/email")).toBe(false);
	});
});
