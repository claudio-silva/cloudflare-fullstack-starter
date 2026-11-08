import { describe, expect, it } from "vitest";
import {
	REMEMBERED_EMAIL_KEY,
	SessionEndedError,
	createAuthFetch,
	createSessionEnded,
	trackPageLeaving,
	withSessionEndedGuard,
} from "../src/react-app/lib/auth/session-ended";
import { CLIENT_ERRORS_PATH } from "../src/shared/http-contract";

/**
 * A session ended under an open page (src/react-app/lib/auth/session-ended.ts).
 * What has to hold: a request answered 401 is held behind the re-login and
 * replayed after it, so its caller never sees the 401 and the page is never
 * unmounted; and nothing held is ever sent under another account.
 */

const ORIGIN = "http://app.test";
const U1 = { id: "u1", email: "a@x" };

function setup(opts: { storage?: boolean } = {}) {
	const map = new Map<string, string>();
	const replaced: string[] = [];
	const state = createSessionEnded({
		storage:
			opts.storage === false
				? null
				: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) },
		replaceLocation: (url) => void replaced.push(url),
	});
	let notified = 0;
	state.subscribe(() => notified++);
	return { map, replaced, state, notified: () => notified };
}

function guardedFetch(state: ReturnType<typeof setup>["state"], status: number) {
	return withSessionEndedGuard((async () => new Response("{}", { status })) as typeof fetch, state, ORIGIN);
}

/** A server that answers 401 until `login()` (the re-login), then 200 with the request's own path. */
function server() {
	let authed = false;
	const calls: { path: string; method: string }[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN);
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
		calls.push({ path: url.pathname + url.search, method });
		await Promise.resolve();
		return authed ? new Response(JSON.stringify({ path: url.pathname + url.search }), { status: 200 }) : new Response('{"error":"x"}', { status: 401 });
	}) as typeof fetch;
	return { fetchImpl, calls, login: () => void (authed = true) };
}
/** `keepalive` is a browser option the Workers typings omit. */
const KEEPALIVE = { keepalive: true } as unknown as RequestInit;
const settle = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("holding and replaying", () => {
	it("one held request: the caller never sees the 401 and gets the replay's response", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const counts: number[] = [];
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN, { onHeldChange: (n) => counts.push(n) });
		let settled = false;
		const pending = f("/api/profile", { method: "POST", body: "{}" }).then((r) => ((settled = true), r));
		await settle();
		expect(s.state.isEnded()).toBe(true);
		expect(settled).toBe(false);
		expect(srv.calls).toHaveLength(1);
		srv.login();
		s.state.sessionSeen(U1);
		const res = await pending;
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ path: "/api/profile" });
		expect(srv.calls).toHaveLength(2);
		expect(counts).toEqual([1, 0]);
	});

	it("requests made while ended never reach the network; all resolve after restore, once each", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		const first = f("/api/a");
		await settle();
		const others = [f("/api/b"), f("/api/c", { method: "POST", body: "1" }), f(new Request("http://app.test/api/d"))];
		await settle();
		expect(srv.calls).toHaveLength(1);
		srv.login();
		s.state.sessionSeen(U1);
		for (const r of await Promise.all([first, ...others])) expect(r.status).toBe(200);
		expect(srv.calls.map((c) => c.path).sort()).toEqual(["/api/a", "/api/a", "/api/b", "/api/c", "/api/d"]);
	});

	it("identical GETs merge into one network call; each caller reads its own body", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		const first = f("/api/poll?x=1");
		await settle();
		const dupes = [f("/api/poll?x=1"), f("/api/poll?x=1"), f("/api/poll?x=2")];
		await settle();
		srv.login();
		s.state.sessionSeen(U1);
		const all = await Promise.all([first, ...dupes]);
		expect(await Promise.all(all.map((r) => r.json()))).toEqual([
			{ path: "/api/poll?x=1" },
			{ path: "/api/poll?x=1" },
			{ path: "/api/poll?x=1" },
			{ path: "/api/poll?x=2" },
		]);
		expect(srv.calls.slice(1).map((c) => c.path).sort()).toEqual(["/api/poll?x=1", "/api/poll?x=2"]);
	});

	it("writes are never merged and replay one at a time, in arrival order", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const order: string[] = [];
		let inFlight = 0;
		let maxInFlight = 0;
		let authed = false;
		const fetchImpl = (async (input: RequestInfo | URL) => {
			const path = String(input);
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			if (!authed) return new Response("{}", { status: 401 });
			order.push(path);
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const f = withSessionEndedGuard(fetchImpl, s.state, ORIGIN);
		const calls = [f("/api/w", { method: "POST", body: "same" })];
		await new Promise((r) => setTimeout(r, 20));
		calls.push(f("/api/w", { method: "POST", body: "same" }), f("/api/w2", { method: "PATCH", body: "x" }), f("/api/w", { method: "POST", body: "same" }));
		await new Promise((r) => setTimeout(r, 20));
		authed = true;
		maxInFlight = 0;
		s.state.sessionSeen(U1);
		await Promise.all(calls);
		expect(order).toEqual(["/api/w", "/api/w", "/api/w2", "/api/w"]);
		expect(maxInFlight).toBe(1);
	});

	it("replay cap: the third 401 (original, replay, replay) reaches the caller", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const calls: string[] = [];
		const fetchImpl = (async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return new Response("{}", { status: 401 });
		}) as typeof fetch;
		const f = withSessionEndedGuard(fetchImpl, s.state, ORIGIN);
		const pending = f("/api/a");
		await settle();
		s.state.sessionSeen(U1);
		await settle();
		expect(calls).toHaveLength(2);
		s.state.sessionSeen(U1);
		expect((await pending).status).toBe(401);
		expect(calls).toHaveLength(3);
	});

	it("a Request input is held and replayed from a clone", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		const pending = f(new Request("http://app.test/api/x", { method: "POST", body: "{}" }));
		await settle();
		expect(s.state.isEnded()).toBe(true);
		srv.login();
		s.state.sessionSeen(U1);
		expect((await pending).status).toBe(200);
	});

	it("aborting a held request rejects it, lowers the held count and replays nothing", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const counts: number[] = [];
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN, { onHeldChange: (n) => counts.push(n) });
		const ac = new AbortController();
		const pending = f("/api/a", { method: "POST", body: "1", signal: ac.signal });
		await settle();
		expect(counts).toEqual([1]);
		ac.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(counts).toEqual([1, 0]);
		srv.login();
		s.state.sessionSeen(U1);
		await settle();
		expect(srv.calls).toHaveLength(1);
	});

	it("onHeldChange reports writes apart from reads", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const seen: { writes: number }[] = [];
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN, { onHeldChange: (_n, sum) => seen.push(sum) });
		const a = f("/api/credits");
		const b = f("/api/posts", { method: "POST", body: "{}" });
		await settle();
		expect(seen[seen.length - 1]).toEqual({ writes: 1 });
		srv.login();
		s.state.sessionSeen(U1);
		await Promise.all([a, b]);
		expect(seen[seen.length - 1]).toEqual({ writes: 0 });
	});

	it("a rejecting fetch rejects with the same error", async () => {
		const boom = new Error("boom");
		const f = withSessionEndedGuard((async () => { throw boom; }) as typeof fetch, setup().state, ORIGIN);
		await expect(f("/api/x")).rejects.toBe(boom);
	});
});

describe("what is not held", () => {
	it("keepalive while unloading, the error reports, stream bodies and /api/auth/ get their 401 and still mark ended", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN, { isUnloading: () => true });
		expect((await f("/api/posts/x/finalize", { method: "POST", ...KEEPALIVE, body: "{}" })).status).toBe(401);
		expect(s.state.isEnded()).toBe(true);

		const t = setup();
		t.state.sessionSeen(U1);
		const stream = new ReadableStream({ start: (c) => c.close() });
		const r2 = await withSessionEndedGuard(server().fetchImpl, t.state, ORIGIN)("/api/up", { method: "POST", body: stream, duplex: "half" } as RequestInit);
		expect(r2.status).toBe(401);

		// While ended, nothing of these is delayed.
		expect((await f("/api/auth/get-session")).status).toBe(401);
		expect((await f("/api/x", { method: "POST", ...KEEPALIVE, body: "{}" })).status).toBe(401);
		expect((await f(CLIENT_ERRORS_PATH, { method: "POST", body: "{}" })).status).toBe(401);
	});

	it("a never-held path is answered at once even while ended and not unloading", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN, { isUnloading: () => false });
		expect((await f(CLIENT_ERRORS_PATH, { method: "POST", ...KEEPALIVE, body: "[]" })).status).toBe(401);
		expect(srv.calls).toHaveLength(1);
	});

	it("no trigger for exempt, foreign, non-api, non-401 and unarmed cases", async () => {
		const armed = setup();
		armed.state.sessionSeen(U1);
		await guardedFetch(armed.state, 401)("/api/auth/sign-in/email");
		await guardedFetch(armed.state, 401)("http://other.test/api/x");
		await guardedFetch(armed.state, 401)("/assets/x");
		await guardedFetch(armed.state, 403)("/api/credits");
		expect(armed.notified()).toBe(0);
		expect(armed.state.isEnded()).toBe(false);

		const unarmed = setup();
		unarmed.map.set(REMEMBERED_EMAIL_KEY, "a@x"); // remembered, yet this tab never saw a session
		await guardedFetch(unarmed.state, 401)("/api/credits");
		expect(unarmed.notified()).toBe(0);
		expect(unarmed.replaced).toEqual([]);
	});

	it("a keepalive write is held and replayed once while the page is alive", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN, { isUnloading: () => false });
		const pending = f("/api/profile", { method: "PATCH", ...KEEPALIVE, body: "{}" });
		await settle();
		expect(srv.calls).toHaveLength(1);
		srv.login();
		s.state.sessionSeen(U1);
		expect((await pending).status).toBe(200);
		expect(srv.calls.map((c) => c.method)).toEqual(["PATCH", "PATCH"]);
	});

	it("the real unloading default: pagehide leaves a keepalive write unheld, pageshow holds it again", async () => {
		const handlers = new Map<string, () => void>();
		trackPageLeaving({ addEventListener: (type, fn) => void handlers.set(type, fn) });
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN); // no isUnloading seam

		handlers.get("pagehide")?.();
		expect((await f("/api/posts/x/stop", { method: "POST", ...KEEPALIVE, body: "{}" })).status).toBe(401);

		handlers.get("pageshow")?.();
		const pending = f("/api/posts/x/stop", { method: "POST", ...KEEPALIVE, body: "{}" });
		await settle();
		srv.login();
		s.state.sessionSeen(U1);
		expect((await pending).status).toBe(200);
	});
});

describe("leaving and other accounts", () => {
	it("another account signing in leaves held requests pending, navigates once, and never replays them under the new user", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		const held = f("/api/posts/1", { method: "PATCH", body: "{}" });
		await settle();
		expect(srv.calls).toHaveLength(1);
		srv.login();
		let outcome = "pending";
		held.then(() => (outcome = "resolved"), () => (outcome = "rejected"));
		s.state.sessionSeen({ id: "u2", email: "b@x" });
		s.state.sessionSeen({ id: "u2", email: "b@x" });
		await settle();
		expect(outcome).toBe("pending");
		expect(srv.calls).toHaveLength(1);
		expect(s.replaced).toEqual(["/"]);
	});

	it("a different user id after one was seen goes to / even when the session never ended", () => {
		const s = setup();
		s.state.sessionSeen(U1);
		s.state.sessionSeen(U1);
		expect(s.replaced).toEqual([]);
		s.state.sessionSeen({ id: "u2", email: "b@x" });
		expect(s.replaced).toEqual(["/"]);
	});

	it("leave() freezes the restore logic until resume()", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		const srv = server();
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		const held = f("/api/a");
		await settle();
		s.state.leave();
		srv.login();
		s.state.sessionSeen(U1);
		await settle();
		expect(srv.calls).toHaveLength(1);
		s.state.resume();
		s.state.sessionSeen(U1);
		expect((await held).status).toBe(200);
	});

	it("restore: the same user closes the dialog and resolves whenRestored", async () => {
		const s = setup();
		s.state.sessionSeen(U1);
		s.state.markEnded();
		let resolved = false;
		void s.state.whenRestored().then(() => (resolved = true));
		s.state.sessionSeen(U1);
		await Promise.resolve();
		expect(s.state.isEnded()).toBe(false);
		expect(resolved).toBe(true);
		expect(s.replaced).toEqual([]);
		expect(s.notified()).toBe(2);
	});

	it("privacy rule: no remembered email means one navigation to / and never an ended state", () => {
		for (const storage of [true, false]) {
			const s = setup({ storage });
			s.state.sessionSeen(U1);
			s.state.signingOut();
			s.state.sessionSeen(U1);
			s.map.delete(REMEMBERED_EMAIL_KEY);
			s.state.markEnded();
			s.state.markEnded();
			expect(s.replaced, `storage=${storage}`).toEqual(["/"]);
			expect(s.state.isEnded()).toBe(false);
		}
	});

	it("signingOut clears the remembered email and the armed state", () => {
		const s = setup();
		s.state.sessionSeen(U1);
		expect(s.map.get(REMEMBERED_EMAIL_KEY)).toBe("a@x");
		s.state.signingOut();
		expect(s.map.has(REMEMBERED_EMAIL_KEY)).toBe(false);
		expect(s.state.isArmed()).toBe(false);
	});
});

describe("the auth fetch", () => {
	const session = (user: { id: string; email: string }) => new Response(JSON.stringify({ user, session: { id: "s1" } }), { status: 200 });
	const noSession = () => new Response("null", { status: 200 });
	const getSession = (f: typeof fetch) => f("/api/auth/get-session");

	it("remembers on get-session, forgets before a sign-out is sent, then an unarmed null returns normally", async () => {
		const s = setup();
		let keyAtSignOut: string | null | undefined;
		let next: () => Response = () => session(U1);
		const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes("sign-out")) {
				keyAtSignOut = s.map.get(REMEMBERED_EMAIL_KEY) ?? null;
				expect(init?.method).toBe("POST");
				return new Response("{}", { status: 200 });
			}
			return next();
		}) as typeof fetch;
		const f = createAuthFetch(s.state, () => fake);
		await getSession(f);
		expect(s.map.get(REMEMBERED_EMAIL_KEY)).toBe("a@x");
		expect(s.state.tabSessionId()).toBe("s1");
		await f("/api/auth/sign-out", { method: "POST" });
		expect(keyAtSignOut).toBeNull();
		next = noSession;
		expect(await (await getSession(f)).json()).toBeNull();
		expect(s.state.isEnded()).toBe(false);
	});

	it("armed with a remembered email, a null get-session ends the session and throws SessionEndedError", async () => {
		const s = setup();
		let next: () => Response = () => session(U1);
		const f = createAuthFetch(s.state, () => (async () => next()) as typeof fetch);
		await getSession(f);
		next = noSession;
		await expect(getSession(f)).rejects.toBeInstanceOf(SessionEndedError);
		expect(s.state.isEnded()).toBe(true);
	});
});
