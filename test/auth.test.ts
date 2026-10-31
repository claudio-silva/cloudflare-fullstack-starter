import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/worker/index";

const json = { "content-type": "application/json" };
const post = (path: string, body: unknown, headers: Record<string, string> = {}, e: object = env) =>
	app.request(path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) }, e);
const createUser = (email: string, password: string) =>
	post("/api/cli/users", { email, password, name: "Test" }, { "x-api-key": env.CLI_API_KEY as string });

describe("auth", () => {
	it("refuses a wrong password with 401 (the suite tolerates Better Auth's stray rejection)", async () => {
		const email = `wrong-${Date.now()}@example.com`;
		expect((await createUser(email, "right-password-1")).status).toBeLessThan(300);
		const res = await post("/api/auth/sign-in/email", { email, password: "wrong-password-2" });
		expect(res.status).toBe(401);
	});

	/*
	 * Local dev is reached under arbitrary hostnames (another port, a LAN IP, a
	 * container or dev-workspace proxy), and a refused origin used to surface as a
	 * "wrong password" the developer could not fix.
	 */
	it("local trusts whatever host served the page, so a proxy hostname can sign in", async () => {
		const email = `origin-local-${Date.now()}@example.com`;
		const password = "right-password-1";
		expect((await createUser(email, password)).status).toBeLessThan(300);
		const local = { ...env, ENVIRONMENT: "local" };
		const res = await post(
			"/api/auth/sign-in/email",
			{ email, password },
			{ origin: "http://dev--workspace-1a2b3c.localhost:6767" },
			local,
		);
		expect(res.status).toBeLessThan(300);
	});

	it("a wrong password is still a wrong password, whatever host it comes from", async () => {
		const email = `origin-wrong-${Date.now()}@example.com`;
		expect((await createUser(email, "right-password-1")).status).toBeLessThan(300);
		const local = { ...env, ENVIRONMENT: "local" };
		const res = await post(
			"/api/auth/sign-in/email",
			{ email, password: "wrong-password-2" },
			{ origin: "http://dev--workspace-1a2b3c.localhost:6767" },
			local,
		);
		expect(res.status).toBe(401);
		expect((await res.json() as { code?: string }).code).toBe("INVALID_EMAIL_OR_PASSWORD");
	});

	it("preview keeps the strict origin check, so a foreign host is refused", async () => {
		const email = `origin-preview-${Date.now()}@example.com`;
		const password = "right-password-1";
		expect((await createUser(email, password)).status).toBeLessThan(300);
		const preview = {
			...env,
			ENVIRONMENT: "preview",
			APP_BASE_URL: "https://preview.example.com",
			BETTER_AUTH_SECRET: "test-secret-for-the-preview-path",
		};
		const res = await post(
			"/api/auth/sign-in/email",
			{ email, password },
			{ origin: "https://attacker.example.net" },
			preview,
		);
		expect(res.status).toBe(403);
		expect((await res.json() as { code?: string }).code).toBe("INVALID_ORIGIN");
	});

	it("the reset answer does not wait for the email provider, so it cannot tell whether an account exists", async () => {
		const email = `send-slow-${Date.now()}@example.com`;
		expect((await createUser(email, "old-password-1")).status).toBeLessThan(300);

		// A provider that is slow and then fails: Better Auth awaits sendResetPassword for real accounts only.
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const slow = { ...env, AUTH_EMAILS_LOCAL_ENABLED: "true", EMAIL: { send: async () => { await gate; throw new Error("provider down"); } } };
		const body = { redirectTo: "/reset-password" };
		const timeout = new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 2000));

		const existing = await Promise.race([post("/api/auth/request-password-reset", { email, ...body }, {}, slow), timeout]);
		release();
		expect(existing, "the request waited for the email provider").not.toBe("waited");
		const unknown = await post("/api/auth/request-password-reset", { email: "nobody-here@example.com", ...body }, {}, slow);
		const res = existing as Response;
		expect(res.status).toBe(200);
		expect(unknown.status).toBe(200);
		expect(await res.json()).toEqual(await unknown.json());
	});
});
