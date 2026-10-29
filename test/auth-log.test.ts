import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/worker/index";

// "[AUTH] Environment: …" used to be printed on every request in the local environment.
// It is printed once per isolate now. This file runs in its own isolate, so the first request here is the first one.
describe("auth startup log", () => {
	afterEach(() => vi.restoreAllMocks());

	it("prints the environment summary once, however many requests follow", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const local = { ...env, ENVIRONMENT: "local" };
		for (let i = 0; i < 4; i++) {
			const res = await app.request("/api/auth/get-session", {}, local);
			expect(res.status).toBe(200);
		}
		const lines = log.mock.calls.filter(([first]) => typeof first === "string" && first.startsWith("[AUTH] Environment"));
		expect(lines).toHaveLength(1);
	});
});
