import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/worker/index";
import { AppError, errorResponse, fail } from "../src/worker/lib/errors";
import { versionMiddleware } from "../src/worker/middleware/version";
import { resetClientErrorBudget } from "../src/worker/routes/client-errors";
import { APP_VERSION } from "../src/shared/app-version";
import {
	APP_VERSION_HEADER,
	CLIENT_ERRORS_PATH,
	CLIENT_INCOMPATIBLE_CODE,
	CLIENT_VERSION_HEADER,
	compatibilityLine,
	isBreakingChange,
	type ApiErrorBody,
} from "../src/shared/http-contract";
import type { AppBindings } from "../src/worker/types/context";

// In workerd, `console.warn` stays a wrapper after vi.spyOn: assert on the spy itself.
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/**
 * The server half of the HTTP contract (src/shared/http-contract.ts): every
 * error response has the same shape, the user's message and the developer's
 * never mix in production, and every response says which version answered.
 */

/** A small app wired the way src/worker/index.ts wires the real one. */
function errorApp() {
	const a = new Hono<AppBindings>();
	a.use("*", versionMiddleware);
	a.onError((error, c) => errorResponse(c, error));
	a.get("/app-error", () => {
		throw new AppError(403, "You can't edit someone else's post.", { log: "user 1 tried post 2", code: "post_not_owned" });
	});
	a.get("/fail", (c) => fail(c, 409, "Already taken.", { log: "slug clash", level: "info" }));
	a.get("/bug", () => {
		throw new TypeError("cannot read properties of undefined (reading 'id')");
	});
	a.get("/http-exception", () => {
		throw new HTTPException(400, { message: "Malformed JSON" });
	});
	return a;
}

const run = async (path: string, environment = "test") => {
	const res = await errorApp().request(path, {}, { ...env, ENVIRONMENT: environment });
	return { res, body: (await res.json()) as ApiErrorBody };
};

describe("error responses", () => {
	it("sends an AppError's user message and code, and logs only the developer's message", async () => {
		const { res, body } = await run("/app-error", "production");
		expect(res.status).toBe(403);
		expect(body).toMatchObject({ error: "You can't edit someone else's post.", code: "post_not_owned" });
		expect(body.requestId).toBeTruthy();
		// The point of the split: in production the real cause never travels.
		expect(JSON.stringify(body)).not.toContain("user 1 tried post 2");
		expect(warn).toHaveBeenCalledWith("[api]", expect.objectContaining({ msg: "user 1 tried post 2", status: 403 }));
		expect(error).not.toHaveBeenCalled();
	});

	it("attaches the real cause as `debug` outside production", async () => {
		const { body } = await run("/app-error");
		expect(body.debug?.message).toBe("user 1 tried post 2");
	});

	it("returns the same shape from fail(), with the level the handler chose", async () => {
		const { res, body } = await run("/fail", "production");
		expect(res.status).toBe(409);
		expect(body).toMatchObject({ error: "Already taken.", level: "info" });
		expect(body.debug).toBeUndefined();
	});

	it("turns an unexpected error into a generic 500, logged as an error with its stack", async () => {
		const { res, body } = await run("/bug", "production");
		expect(res.status).toBe(500);
		expect(body).toMatchObject({ error: "Something went wrong on our side.", code: "internal" });
		expect(JSON.stringify(body)).not.toContain("reading 'id'");
		expect(error).toHaveBeenCalledWith("[api]", expect.objectContaining({ status: 500, stack: expect.any(String) }));
	});

	it("keeps an HTTPException's status and message", async () => {
		const { res, body } = await run("/http-exception");
		expect(res.status).toBe(400);
		expect(body).toMatchObject({ error: "Malformed JSON", code: "http_400" });
	});

	it("stamps the version on success and error responses alike", async () => {
		expect((await run("/bug")).res.headers.get(APP_VERSION_HEADER)).toBe(APP_VERSION);
		expect((await app.request("/api/", {}, env)).headers.get(APP_VERSION_HEADER)).toBe(APP_VERSION);
	});
});

describe("the real app's error responses", () => {
	it("answers an unknown API route with a JSON 404 carrying the version", async () => {
		const res = await app.request("/api/does-not-exist", {}, env);
		expect(res.status).toBe(404);
		expect(res.headers.get(APP_VERSION_HEADER)).toBe(APP_VERSION);
		expect(await res.json()).toMatchObject({ error: "Not found.", code: "not_found" });
	});

	// "local", because the test environment signs everyone in as a test user.
	it("answers a protected route without a session with the contract's 401", async () => {
		const res = await app.request("/api/protected/ping", {}, { ...env, ENVIRONMENT: "local" });
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ code: "unauthenticated", error: expect.any(String) });
	});
});

describe("incompatible clients", () => {
	const versionApp = () => {
		const a = new Hono<AppBindings>();
		a.use("*", versionMiddleware);
		a.all("*", (c) => c.text("ok"));
		return a;
	};
	const ask = (path: string, version?: string) =>
		versionApp().request(path, { method: "POST", headers: version ? { [CLIENT_VERSION_HEADER]: version } : {} }, env);

	it("refuses API requests from a tab of another major, with a 426 the browser recognises", async () => {
		const res = await ask("/api/posts", "999.0.0");
		expect(res.status).toBe(426);
		expect(res.headers.get(APP_VERSION_HEADER)).toBe(APP_VERSION);
		expect(await res.json()).toMatchObject({ code: CLIENT_INCOMPATIBLE_CODE, error: expect.any(String) });
	});

	it("lets through compatible tabs, callers that do not say their version, error reports and pages", async () => {
		expect((await ask("/api/posts", APP_VERSION)).status).toBe(200);
		expect((await ask("/api/posts")).status).toBe(200);
		expect((await ask("/api/posts", "unknown")).status).toBe(200);
		expect((await ask(CLIENT_ERRORS_PATH, "999.0.0")).status).toBe(200);
		expect((await ask("/dashboard", "999.0.0")).status).toBe(200);
	});

	it("takes a new major, or a new minor before 1.0.0, as breaking — in either direction", () => {
		expect(isBreakingChange("1.9.9", "2.0.0")).toBe(true);
		expect(isBreakingChange("2.0.0", "1.9.9")).toBe(true);
		expect(isBreakingChange("2.0.0", "2.7.3")).toBe(false);
		expect(isBreakingChange("0.3.9", "0.4.0")).toBe(true);
		expect(isBreakingChange("0.3.1", "0.3.9")).toBe(false);
		expect(isBreakingChange("2.0.0-rc.1", "2.0.0")).toBe(false);
		expect(compatibilityLine("v1.2.3+preview.ab12cd3")).toBe("1");
		expect(isBreakingChange("abc123", "2.0.0")).toBe(false);
	});
});

describe("client error reports", () => {
	const origin = "http://localhost";
	const report = (overrides: Record<string, unknown> = {}) => ({
		kind: "error",
		message: "TypeError: x is undefined",
		page: `${origin}/dashboard`,
		at: Date.now(),
		...overrides,
	});
	const post = (body: unknown, headers: Record<string, string> = {}) => {
		const text = typeof body === "string" ? body : JSON.stringify(body);
		return app.request(
			`${origin}${CLIENT_ERRORS_PATH}`,
			{
				method: "POST",
				body: text,
				headers: {
					"Content-Type": "application/json",
					"Content-Length": String(text.length),
					Origin: origin,
					"CF-Connecting-IP": "203.0.113.7",
					[CLIENT_VERSION_HEADER]: "1.2.3",
					...headers,
				},
			},
			env,
		);
	};
	const logged = () => warn.mock.calls.filter(([tag]: unknown[]) => tag === "[client]");

	beforeEach(() => resetClientErrorBudget());

	it("logs a valid report with the client's version, tagged as coming from the client", async () => {
		const res = await post({ reports: [report()] });
		expect(res.status).toBe(204);
		expect(logged()).toHaveLength(1);
		expect(logged()[0][1]).toMatchObject({ source: "client", clientVersion: "1.2.3", message: "TypeError: x is undefined" });
	});

	it("truncates long strings instead of logging them whole", async () => {
		await post({ reports: [report({ message: "x".repeat(5_000) })] });
		expect((logged()[0][1] as { message: string }).message.length).toBeLessThanOrEqual(1_001);
	});

	// Every refusal looks exactly like an acceptance: probing the endpoint teaches nothing.
	it.each([
		["another site's origin", () => post({ reports: [report()] }, { Origin: "https://evil.example" })],
		["no origin at all", () => post({ reports: [report()] }, { Origin: "" })],
		["a body that is not JSON", () => post("not json")],
		["a report of an unknown kind", () => post({ reports: [report({ kind: "sql" })] })],
		["too many reports in one batch", () => post({ reports: Array.from({ length: 11 }, () => report()) })],
		["a body over the size cap", () => post({ reports: [report()] }, { "Content-Length": String(64 * 1024) })],
	])("answers 204 and logs nothing for %s", async (_, send) => {
		const res = await send();
		expect(res.status).toBe(204);
		expect(logged()).toHaveLength(0);
	});

	it("stops logging an address that floods it, without affecting others", async () => {
		for (let i = 0; i < 30; i++) await post({ reports: [report({ message: `flood ${i}` })] });
		expect(logged()).toHaveLength(20);

		await post({ reports: [report({ message: "someone else" })] }, { "CF-Connecting-IP": "198.51.100.1" });
		expect(logged()).toHaveLength(21);
	});

	it("uses the Rate Limiting binding when there is one", async () => {
		const limit = vi.fn(async () => ({ success: false }));
		const text = JSON.stringify({ reports: [report()] });
		const res = await app.request(
			`${origin}${CLIENT_ERRORS_PATH}`,
			{
				method: "POST",
				body: text,
				headers: { "Content-Type": "application/json", "Content-Length": String(text.length), Origin: origin, "CF-Connecting-IP": "203.0.113.9" },
			},
			{ ...env, CLIENT_ERRORS_RATE_LIMITER: { limit } },
		);
		expect(res.status).toBe(204);
		expect(limit).toHaveBeenCalledWith({ key: "203.0.113.9" });
		expect(logged()).toHaveLength(0);
	});
});
