import { afterEach, describe, expect, it, vi } from "vitest";
import {
	installMaintenanceInterceptor,
	getMaintenanceState,
	subscribeToMaintenance,
	parseRetryAfterMs,
} from "../src/react-app/lib/maintenance";

/**
 * The interceptor's job is to make a maintenance window invisible to call
 * sites. What has to hold, and what these cover:
 *
 *  - a held request eventually resolves with the real response, not the 503;
 *  - once the app is known to be down, later requests are NOT sent at all —
 *    only the first 503 costs a round trip, the rest wait;
 *  - concurrent requests share ONE polling loop;
 *  - every held request goes out once recovered, with its own method and payload;
 *  - a 503 that is not ours is passed straight through.
 */

const maintenance = (retryAfter?: string) =>
	new Response(JSON.stringify({ code: "maintenance" }), {
		status: 503,
		headers: { "x-maintenance": "1", ...(retryAfter ? { "retry-after": retryAfter } : {}) },
	});
const ok = (body = "{}") => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

let uninstall: (() => void) | undefined;

afterEach(() => {
	uninstall?.();
	uninstall = undefined;
	vi.unstubAllGlobals();
});

type Call = { url: string; method: string; body?: unknown };

/**
 * A fake server that is down until `downForProbes` probes have gone by, or —
 * when `gated` is set — until `release()` is called, so a test can inspect the
 * world mid-outage without racing a timer.
 */
function fakeServer(opts: { downForProbes: number; retryAfter?: string; gated?: boolean }) {
	const calls: Call[] = [];
	let probes = 0;
	let released = false;
	const isUp = () => (opts.gated ? released : probes > opts.downForProbes);
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, method: init?.method ?? "GET", body: init?.body });
		if (url === "/api/") {
			probes += 1;
			return isUp() ? ok('{"status":"healthy"}') : maintenance(opts.retryAfter);
		}
		return isUp() ? ok(`{"url":"${url}"}`) : maintenance(opts.retryAfter);
	});
	return { calls, fetchImpl, probeCount: () => probes, release: () => { released = true; } };
}

describe("maintenance interceptor", () => {
	it("holds a request and resolves it with the real response once the app returns", async () => {
		const server = fakeServer({ downForProbes: 1 });
		vi.stubGlobal("fetch", server.fetchImpl);
		uninstall = installMaintenanceInterceptor({ pollScheduleMs: [1], maxWaitMs: 5_000 });

		const res = await fetch("/api/profile");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ url: "/api/profile" });
		expect(getMaintenanceState().active).toBe(false);
	});

	// The point of the shared wait: three tabs' worth of calls must not become
	// three polling loops against a server that is already struggling.
	it("gives concurrent requests one shared polling loop, then replays them all", async () => {
		const server = fakeServer({ downForProbes: 3 });
		vi.stubGlobal("fetch", server.fetchImpl);
		uninstall = installMaintenanceInterceptor({ pollScheduleMs: [1], maxWaitMs: 5_000 });

		const results = await Promise.all([
			fetch("/api/a"),
			fetch("/api/b", { method: "POST", body: JSON.stringify({ n: 1 }) }),
			fetch("/api/c"),
		]);

		expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
		// Exactly the probes of the single loop: no second loop was started.
		expect(server.probeCount()).toBe(4);

		// Each held request was replayed once, keeping its method and payload.
		const replays = server.calls.filter((c) => c.url === "/api/b");
		expect(replays).toHaveLength(2);
		expect(replays.every((c) => c.method === "POST")).toBe(true);
		expect(replays.every((c) => c.body === JSON.stringify({ n: 1 }))).toBe(true);
	});

	// The property the whole design turns on: a server that is already failing
	// must not be asked again by every tab that happens to be open.
	it("does not send a request at all once the app is known to be down", async () => {
		const server = fakeServer({ downForProbes: 0, gated: true });
		vi.stubGlobal("fetch", server.fetchImpl);
		uninstall = installMaintenanceInterceptor({ pollScheduleMs: [5], maxWaitMs: 5_000 });

		const first = fetch("/api/first");
		await vi.waitFor(() => expect(getMaintenanceState().active).toBe(true));

		const held = fetch("/api/held");
		// Give it every chance to go out, then prove it did not.
		await new Promise((r) => setTimeout(r, 30));
		expect(server.calls.filter((c) => c.url === "/api/held")).toHaveLength(0);

		server.release();
		await Promise.all([first, held]);
		// It went out exactly once, after recovery — not once to get a 503 and
		// again to be replayed.
		expect(server.calls.filter((c) => c.url === "/api/held")).toHaveLength(1);
	});

	it("reports being down while it waits, and recovers", async () => {
		const server = fakeServer({ downForProbes: 2 });
		vi.stubGlobal("fetch", server.fetchImpl);
		uninstall = installMaintenanceInterceptor({ pollScheduleMs: [1], maxWaitMs: 5_000 });

		const seen: boolean[] = [];
		const stop = subscribeToMaintenance((s) => seen.push(s.active));
		await fetch("/api/profile");
		stop();

		expect(seen).toContain(true);
		expect(seen.at(-1)).toBe(false);
	});

	it("passes a 503 that is not ours straight through", async () => {
		const plain503 = vi.fn(async () => new Response("upstream exploded", { status: 503 }));
		vi.stubGlobal("fetch", plain503);
		uninstall = installMaintenanceInterceptor({ pollScheduleMs: [1], maxWaitMs: 5_000 });

		const res = await fetch("/api/profile");
		expect(res.status).toBe(503);
		// One call: it was never held, so it was never replayed.
		expect(plain503).toHaveBeenCalledTimes(1);
		expect(getMaintenanceState().active).toBe(false);
	});

	it("honours Retry-After for the first poll", () => {
		expect(parseRetryAfterMs("5", 60_000)).toBe(5_000);
		// Clamped: a careless header must not freeze the UI.
		expect(parseRetryAfterMs("99999", 60_000)).toBe(60_000);
		expect(parseRetryAfterMs(null, 60_000)).toBeNull();
		expect(parseRetryAfterMs("not-a-date", 60_000)).toBeNull();
		expect(parseRetryAfterMs("-1", 60_000)).toBeNull();
		// HTTP-date form, as RFC 9110 allows.
		const inTen = new Date(Date.now() + 10_000).toUTCString();
		expect(parseRetryAfterMs(inTen, 60_000)).toBeGreaterThan(8_000);
	});

	it("uses the server's Retry-After rather than its own schedule", async () => {
		// One probe is enough: the question is only how long we waited before it.
		const server = fakeServer({ downForProbes: 0, retryAfter: "1" });
		vi.stubGlobal("fetch", server.fetchImpl);
		uninstall = installMaintenanceInterceptor({ pollScheduleMs: [10_000], maxWaitMs: 8_000 });

		const started = Date.now();
		const res = await fetch("/api/profile");
		const elapsed = Date.now() - started;
		expect(res.status).toBe(200);
		// ~1s from the header, not the 10s the local schedule would have used.
		expect(elapsed).toBeGreaterThanOrEqual(900);
		expect(elapsed).toBeLessThan(4_000);
	});

	it("gives up after maxWaitMs and returns the 503 rather than hanging", async () => {
		const server = fakeServer({ downForProbes: Number.MAX_SAFE_INTEGER });
		vi.stubGlobal("fetch", server.fetchImpl);
		uninstall = installMaintenanceInterceptor({ pollScheduleMs: [1], maxWaitMs: 30 });

		const res = await fetch("/api/profile");
		expect(res.status).toBe(503);
	});
});
