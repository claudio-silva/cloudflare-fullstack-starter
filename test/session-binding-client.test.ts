import { describe, expect, it } from "vitest";
import {
	SESSION_REPLACED_FLAG_KEY,
	consumeSessionReplacedFlag,
	createAuthFetch,
	createSessionEnded,
	withSessionEndedGuard,
} from "../src/react-app/lib/auth/session-ended";

/**
 * Per-tab session binding on the client: the header read at send time, adopt-and-replay for the
 * same account, leave-and-reload for another. Nothing is ever replayed under another account.
 */

const ORIGIN = "http://app.test";
const U1 = { id: "u1", email: "a@x" };
const U2 = { id: "u2", email: "b@x" };
const CHANGED_BODY = '{"error":"The session changed.","code":"session_changed"}';

function setup() {
	const map = new Map<string, string>();
	const flags = new Map<string, string>();
	const replaced: string[] = [];
	const state = createSessionEnded({
		storage: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) },
		flagStorage: { setItem: (k, v) => void flags.set(k, v) },
		replaceLocation: (url) => void replaced.push(url),
	});
	return { flags, replaced, state };
}

// Body reads in workerd take real ticks, not just microtasks.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 50));
const pathOf = (input: RequestInfo | URL) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN).pathname;
const sentId = (input: RequestInfo | URL, init?: RequestInit): string | null =>
	new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("x-session-id");

type Current = { user: { id: string; email: string }; sessionId: string } | null;

/** A server whose cookie resolves to `current`: another `X-Session-Id` is refused 409, get-session answers `current`. */
function bound(initial: Current) {
	const server = { current: initial };
	const calls: { path: string; sent: string | null }[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const path = pathOf(input);
		const sent = sentId(input, init);
		calls.push({ path, sent });
		await Promise.resolve();
		if (path === "/api/auth/get-session") {
			return new Response(JSON.stringify(server.current && { user: server.current.user, session: { id: server.current.sessionId } }), { status: 200 });
		}
		if (!server.current) return new Response('{"error":"x"}', { status: 401 });
		if (sent !== null && sent !== server.current.sessionId) return new Response(CHANGED_BODY, { status: 409 });
		return new Response(JSON.stringify({ path }), { status: 200 });
	}) as typeof fetch;
	return { server, calls, fetchImpl };
}

describe("the X-Session-Id header", () => {
	it("is added to every same-origin /api/ request, read at send time", async () => {
		const s = setup();
		const srv = bound({ user: U1, sessionId: "s2" });
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		await f("/api/profile"); // no id yet: nothing sent, no check
		s.state.sessionSeen(U1, "s2");
		await f("/api/profile", { headers: { "x-other": "1" } });
		await f(new Request(`${ORIGIN}/api/profile`));
		await f("/elsewhere");
		expect(srv.calls.map((c) => c.sent)).toEqual([null, "s2", "s2", null]);
	});

	it("a replay after an adoption carries the new id", async () => {
		const s = setup();
		s.state.sessionSeen(U1, "s1");
		const srv = bound({ user: U1, sessionId: "s2" });
		const res = await withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN)("/api/items/1", { method: "PATCH", body: "{}" });
		expect(res.status).toBe(200);
		expect(srv.calls.map((c) => `${c.path}:${c.sent}`)).toEqual(["/api/items/1:s1", "/api/auth/get-session:null", "/api/items/1:s2"]);
	});
});

describe("a 409 session_changed", () => {
	it("for the same user adopts the id and replays once; the caller gets the 200", async () => {
		const s = setup();
		s.state.sessionSeen(U1, "s1");
		const srv = bound({ user: U1, sessionId: "s2" });
		const res = await withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN)("/api/items/1", { method: "PATCH", body: "{}" });
		expect(res.status).toBe(200);
		expect(s.state.tabSessionId()).toBe("s2");
		expect(srv.calls.filter((c) => c.path === "/api/items/1")).toHaveLength(2);
		expect(s.replaced).toEqual([]);
	});

	it("shared by concurrent requests: one get-session, each replayed once", async () => {
		const s = setup();
		s.state.sessionSeen(U1, "s1");
		const srv = bound({ user: U1, sessionId: "s2" });
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		const out = await Promise.all([f("/api/a"), f("/api/b", { method: "POST", body: "{}" }), f("/api/c", { method: "POST", body: "{}" })]);
		expect(out.map((r) => r.status)).toEqual([200, 200, 200]);
		expect(srv.calls.filter((c) => c.path === "/api/auth/get-session")).toHaveLength(1);
		for (const p of ["/api/a", "/api/b", "/api/c"]) expect(srv.calls.filter((c) => c.path === p), p).toHaveLength(2);
	});

	it("refused again after the replay is returned as is: never a loop", async () => {
		const s = setup();
		s.state.sessionSeen(U1, "s1");
		let n = 0;
		const fetchImpl = (async (input: RequestInfo | URL) => {
			if (pathOf(input) === "/api/auth/get-session") return new Response(JSON.stringify({ user: U1, session: { id: "s2" } }), { status: 200 });
			n++;
			return new Response(CHANGED_BODY, { status: 409 });
		}) as typeof fetch;
		const res = await withSessionEndedGuard(fetchImpl, s.state, ORIGIN)("/api/x", { method: "POST", body: "{}" });
		expect(res.status).toBe(409);
		expect(n).toBe(2);
	});

	it("for a different user never settles, is never replayed, sets the flag and replaces to / once", async () => {
		const s = setup();
		s.state.sessionSeen(U1, "s1");
		const srv = bound({ user: U2, sessionId: "s9" });
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		let settled = false;
		void f("/api/items/1", { method: "PATCH", body: "{}" }).then(() => (settled = true), () => (settled = true));
		await settle();
		expect(settled).toBe(false);
		expect(srv.calls.filter((c) => c.path === "/api/items/1")).toHaveLength(1);
		expect(s.replaced).toEqual(["/"]);
		expect(s.flags.get(SESSION_REPLACED_FLAG_KEY)).toBe("1");
		expect(s.state.tabSessionId()).toBe("s1"); // the other account's id is not adopted
		void f("/api/profile").then(() => (settled = true), () => (settled = true));
		await settle();
		expect(settled).toBe(false);
		expect(s.replaced).toEqual(["/"]);
	});

	it("for a request that cannot be held (an /api/auth/ route) still leaves for another account", async () => {
		const s = setup();
		s.state.sessionSeen(U1, "s1");
		const srv = bound({ user: U2, sessionId: "s9" });
		const f = withSessionEndedGuard(srv.fetchImpl, s.state, ORIGIN);
		let settled = false;
		void f("/api/auth/update-user", { method: "POST", body: "{}" }).then(() => (settled = true), () => (settled = true));
		await settle();
		expect(settled).toBe(false);
		expect(s.replaced).toEqual(["/"]);
	});

	it("when the session is gone falls into the session-ended hold; the replay after the re-login carries the new id", async () => {
		const s = setup();
		s.state.sessionSeen(U1, "s1");
		const srv = bound(null);
		let first = true;
		const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
			if (first && pathOf(input) !== "/api/auth/get-session") {
				first = false;
				return Promise.resolve(new Response(CHANGED_BODY, { status: 409 }));
			}
			return srv.fetchImpl(input, init);
		}) as typeof fetch;
		const f = withSessionEndedGuard(fetchImpl, s.state, ORIGIN);
		let done = false;
		const pending = f("/api/profile", { method: "POST", body: "{}" }).then((r) => ((done = true), r));
		await settle();
		expect(s.state.isEnded()).toBe(true);
		expect(done).toBe(false);
		srv.server.current = { user: U1, sessionId: "s3" };
		s.state.sessionSeen(U1, "s3");
		expect((await pending).status).toBe(200);
		expect(srv.calls[srv.calls.length - 1]?.sent).toBe("s3");
	});
});

describe("sessionSeen and the toast flag", () => {
	it("the same user adopts a new id; a different user leaves once, even when called twice", () => {
		const s = setup();
		s.state.sessionSeen(U1, "s1");
		s.state.sessionSeen(U1, "s2");
		expect(s.state.tabSessionId()).toBe("s2");
		expect(s.replaced).toEqual([]);
		s.state.sessionSeen(U2, "s9");
		s.state.sessionSeen(U2, "s9");
		expect(s.replaced).toEqual(["/"]);
		expect(s.flags.get(SESSION_REPLACED_FLAG_KEY)).toBe("1");
		expect(s.state.tabSessionId()).toBe("s2");
		expect(s.state.isLeaving()).toBe(true);
	});

	it("get-session through createAuthFetch sets the id, a sign-out forgets it, a later sign-in sets the new one", async () => {
		const s = setup();
		let id = "s5";
		const fake = (async (input: RequestInfo | URL) =>
			pathOf(input).endsWith("sign-out") ? new Response("{}") : new Response(JSON.stringify({ user: U1, session: { id } }), { status: 200 })) as typeof fetch;
		const f = createAuthFetch(s.state, () => fake);
		await f("/api/auth/get-session");
		expect(s.state.tabSessionId()).toBe("s5");
		await f("/api/auth/sign-out", { method: "POST" });
		expect(s.state.tabSessionId()).toBeNull();
		id = "s6";
		await f("/api/auth/get-session");
		expect(s.state.tabSessionId()).toBe("s6");
	});

	it("consumeSessionReplacedFlag is true once, then false", () => {
		const store = new Map<string, string>([[SESSION_REPLACED_FLAG_KEY, "1"]]);
		const storage = { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
		expect(consumeSessionReplacedFlag(storage)).toBe(true);
		expect(consumeSessionReplacedFlag(storage)).toBe(false);
		expect(consumeSessionReplacedFlag(null)).toBe(false);
	});
});
