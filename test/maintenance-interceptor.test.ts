import { afterEach, describe, expect, it, vi } from "vitest";
import { installMaintenanceInterceptor, getMaintenanceState, subscribeToMaintenance } from "../src/react-app/lib/maintenance";

/**
 * The interceptor's job is to make a maintenance window invisible to call
 * sites. What has to hold, and what these cover:
 *
 *  - a held request eventually resolves with the real response, not the 503;
 *  - concurrent requests share ONE polling loop, rather than each hammering a
 *    server that is already down;
 *  - every held request is replayed, with its own method and payload;
 *  - a 503 that is not ours is passed straight through.
 */

const maintenance = () => new Response(JSON.stringify({ code: "maintenance" }), { status: 503, headers: { "x-maintenance": "1" } });
const ok = (body = "{}") => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

let uninstall: (() => void) | undefined;

afterEach(() => {
	uninstall?.();
	uninstall = undefined;
	vi.unstubAllGlobals();
});

type Call = { url: string; method: string; body?: unknown };

/** A fake server that is down until `downUntilCall` probes have gone by. */
function fakeServer(opts: { downForProbes: number }) {
	const calls: Call[] = [];
	let probes = 0;
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, method: init?.method ?? "GET", body: init?.body });
		if (url === "/api/") {
			probes += 1;
			return probes > opts.downForProbes ? ok('{"status":"healthy"}') : maintenance();
		}
		return probes > opts.downForProbes ? ok(`{"url":"${url}"}`) : maintenance();
	});
	return { calls, fetchImpl, probeCount: () => probes };
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

	it("gives up after maxWaitMs and returns the 503 rather than hanging", async () => {
		const server = fakeServer({ downForProbes: Number.MAX_SAFE_INTEGER });
		vi.stubGlobal("fetch", server.fetchImpl);
		uninstall = installMaintenanceInterceptor({ pollScheduleMs: [1], maxWaitMs: 30 });

		const res = await fetch("/api/profile");
		expect(res.status).toBe(503);
	});
});
