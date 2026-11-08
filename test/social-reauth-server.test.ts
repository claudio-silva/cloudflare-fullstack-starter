import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Discovery for the social re-login popup (SH-T06): does Better Auth 1.7 accept the relative
 * `callbackURL` / `errorCallbackURL` with `disableRedirect`, keep its state across the popup, and
 * create a session for a Google user? Google itself is stubbed (R40: no credentials exist): the
 * token endpoint answers with an unsigned id_token, which the stubbed `verifyIdToken`-free path reads.
 * The production code is untouched: only `enableGoogleAuth` is mocked.
 */
vi.mock("../src/config", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/config")>();
	return { ...original, config: { ...original.config, auth: { ...original.config.auth, enableGoogleAuth: true } } };
});
const { app } = await import("../src/worker/index");

const local = { ...env, ENVIRONMENT: "local", GOOGLE_CLIENT_ID: "stub-client-id", GOOGLE_CLIENT_SECRET: "stub-client-secret" };
const origin = new URL(local.APP_BASE_URL as string).origin;
const json = { "content-type": "application/json" };

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const email = `social-${Date.now()}@example.com`;
const idToken = `${b64({ alg: "none", typ: "JWT" })}.${b64({ iss: "https://accounts.google.com", aud: "stub-client-id", sub: "stub-google-sub", email, email_verified: true, name: "Social Stub" })}.`;

const realFetch = globalThis.fetch;
let tokenCalls = 0;
beforeEach(() => {
	tokenCalls = 0;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url.startsWith("https://oauth2.googleapis.com/token")) {
			tokenCalls++;
			return new Response(JSON.stringify({ access_token: "stub-access", id_token: idToken, token_type: "Bearer", expires_in: 3600 }), { status: 200, headers: json });
		}
		return realFetch(input, init);
	}) as typeof fetch;
});
afterEach(() => void (globalThis.fetch = realFetch));

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

describe("social sign-in through a popup (Better Auth 1.7, Google stubbed)", () => {
	it("starts with relative callbacks, survives the round trip, creates a session and lists the google account", async () => {
		const start = await app.request(
			"/api/auth/sign-in/social",
			{ method: "POST", headers: { ...json, origin }, body: JSON.stringify({ provider: "google", callbackURL: "/auth/reauth-complete", errorCallbackURL: "/auth/reauth-complete?error=1", disableRedirect: true }) },
			local,
		);
		expect(start.status).toBe(200);
		const { url, redirect } = (await start.json()) as { url: string; redirect: boolean };
		expect(redirect).toBe(false);
		expect(url.startsWith("https://accounts.google.com/")).toBe(true);
		const authUrl = new URL(url);
		expect(authUrl.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
		const state = authUrl.searchParams.get("state");
		expect(state).toBeTruthy();
		const stateCookies = cookiesOf(start);
		expect(stateCookies).not.toBe("");

		// The popup returns from Google: only the state cookie links it to the start.
		const callback = await app.request(`/api/auth/callback/google?code=x&state=${state}`, { headers: { cookie: stateCookies } }, local);
		expect(callback.status).toBe(302);
		expect(new URL(callback.headers.get("location") as string, origin).pathname).toBe("/auth/reauth-complete");
		expect(tokenCalls).toBe(1);
		const session = cookiesOf(callback);
		expect(session).toContain("session_token");

		const accounts = await app.request("/api/auth/list-accounts", { headers: { cookie: session } }, local);
		expect(accounts.status).toBe(200);
		expect(((await accounts.json()) as { providerId: string }[]).map((a) => a.providerId)).toEqual(["google"]);
	});

	it("an error callback lands on errorCallbackURL (the popup page reports failure)", async () => {
		const start = await app.request(
			"/api/auth/sign-in/social",
			{ method: "POST", headers: { ...json, origin }, body: JSON.stringify({ provider: "google", callbackURL: "/auth/reauth-complete", errorCallbackURL: "/auth/reauth-complete?error=1", disableRedirect: true }) },
			local,
		);
		const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state");
		const res = await app.request(`/api/auth/callback/google?error=access_denied&state=${state}`, { headers: { cookie: cookiesOf(start) } }, local);
		expect(res.status).toBe(302);
		const to = new URL(res.headers.get("location") as string, origin);
		expect(to.pathname).toBe("/auth/reauth-complete");
		expect(to.searchParams.has("error")).toBe(true);
	});
});
