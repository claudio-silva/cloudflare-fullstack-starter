import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/worker/index";
import { createEmailSender } from "../src/worker/adapters/email";
import type { AppEnv } from "../src/worker/types/env";
import { maskIp } from "../src/worker/middleware/demo";

/**
 * Demo mode (src/worker/middleware/demo.ts) is what makes a public deployment
 * with a published password safe to leave online: nothing can be changed,
 * nothing can be sent, and sign-in attempts are limited per IP.
 */

const demoEnv = { ...env, DEMO_MODE: "1", DEMO_EMAIL: "demo@example.com", DEMO_PASSWORD: "demo-password" } as AppEnv;
const call = (path: string, init: RequestInit = {}, bindings: AppEnv = demoEnv) => app.request(path, init, bindings);

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("demo mode", () => {
	it.each([
		["DELETE", "/api/profile"],
		["POST", "/api/auth/sign-up/email"],
		["POST", "/api/auth/change-password"],
		["POST", "/api/auth/update-user"],
		["POST", "/api/auth/request-password-reset"],
		["POST", "/api/auth/delete-user"],
	])("refuses %s %s", async (method, path) => {
		const res = await call(path, { method, headers: { "content-type": "application/json" }, body: "{}" });
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ code: "demo_read_only", level: "info" });
	});

	it("gives Better Auth's forms the message in the field they read", async () => {
		const body = (await (await call("/api/auth/change-password", { method: "POST", body: "{}" })).json()) as Record<string, string>;
		expect(body.message).toBe(body.error);
	});

	it("still lets visitors sign in, read, and report errors", async () => {
		const signIn = await call("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			// No password, as in worker.test.ts: refused at validation.
			body: JSON.stringify({ email: "nobody@example.com" }),
		});
		// Refused by Better Auth's validation, not by the demo.
		expect(signIn.status).not.toBe(403);
		expect((await call("/api/")).status).toBe(200);
		expect((await call("/api/client-errors", { method: "POST" })).status).toBe(204);
	});

	it("offers the demo accounts to the sign-in form, lowest role first", async () => {
		const cliKey = { "x-api-key": env.CLI_API_KEY as string, "content-type": "application/json" };
		const stamp = Date.now();
		const [admin, user] = [`admin-${stamp}@example.com`, `user-${stamp}@example.com`];
		for (const [email, role] of [[admin, "admin"], [user, "user"]]) {
			await call("/api/cli/users", { method: "POST", headers: cliKey, body: JSON.stringify({ email, password: "password-123", name: role, role }) });
		}
		const res = await call("/api/demo", {}, { ...demoEnv, DEMO_EMAIL: ` ${admin}, ${user.toUpperCase()} ,missing@example.com` });
		expect(await res.json()).toEqual({
			accounts: [
				{ email: "missing@example.com", password: "demo-password", role: null },
				{ email: user, password: "demo-password", role: "user" },
				{ email: admin, password: "demo-password", role: "admin" },
			],
		});
	});

	it("is off unless the secret says otherwise", async () => {
		expect((await call("/api/demo", {}, env as AppEnv)).status).toBe(404);
		expect((await call("/api/profile", { method: "DELETE" }, env as AppEnv)).status).toBe(200);
	});

	it("does not list the shared account's sessions, which hold other visitors' IPs", async () => {
		const res = await call("/api/auth/list-sessions");
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ code: "demo_hidden" });
		expect((await call("/api/auth/list-sessions", {}, env as AppEnv)).status).not.toBe(403);
	});

	it.each([
		["203.0.113.5", "203.0.113.x"],
		["::ffff:203.0.113.5", "::ffff:203.0.113.x"],
		["2001:db8:85a3:8d3:1319:8a2e:370:7348", "2001:db8:85a3::x"],
		["2001:db8::1", "2001:db8::x"],
		["::1", "::x"],
	])("masks %s as %s", (ip, masked) => expect(maskIp(ip)).toBe(masked));

	it("sends no email, whatever asks it to", async () => {
		const send = vi.fn();
		const sender = createEmailSender({ ...demoEnv, EMAIL: { send } as unknown as SendEmail });
		await sender.sendEmail({ to: "victim@example.com", subject: "spam", html: "<p>spam</p>" });
		expect(send).not.toHaveBeenCalled();
	});
});

describe("auth rate limit", () => {
	it("refuses auth writes from an address over its limit, with a message the sign-in form shows", async () => {
		const limit = vi.fn(async () => ({ success: false }));
		const res = await call(
			"/api/auth/sign-in/email",
			{ method: "POST", headers: { "CF-Connecting-IP": "203.0.113.5" }, body: "{}" },
			{ ...env, AUTH_RATE_LIMITER: { limit } } as AppEnv,
		);
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBe("60");
		expect(await res.json()).toMatchObject({ code: "rate_limited", message: expect.stringContaining("Too many attempts") });
		expect(limit).toHaveBeenCalledWith({ key: "203.0.113.5" });
	});

	it("does not count reads", async () => {
		const limit = vi.fn(async () => ({ success: false }));
		const res = await call("/api/auth/get-session", {}, { ...env, AUTH_RATE_LIMITER: { limit } } as AppEnv);
		expect(res.status).not.toBe(429);
		expect(limit).not.toHaveBeenCalled();
	});
});
