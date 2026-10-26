import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError, installHttpLayer } from "../src/react-app/lib/http/interceptor";
import { HandledHttpError } from "../src/react-app/lib/http/handled-error";
import {
	cancelHeldRequests,
	configureConnection,
	connectionStore,
	resetConnection,
	retryConnectionNow,
} from "../src/react-app/lib/http/connection";
import { postponeUpdate, resetVersionState, updateStore } from "../src/react-app/lib/http/version";
import { flushReports, pendingReports, reportClientError, resetReporter } from "../src/react-app/lib/http/reporter";
import { setTranslator } from "../src/react-app/lib/i18n";
import { APP_VERSION } from "../src/shared/app-version";
import { APP_VERSION_HEADER, CLIENT_VERSION_HEADER, type ApiErrorBody } from "../src/shared/http-contract";

/**
 * The browser half of the HTTP contract (src/react-app/lib/http/). What has
 * to hold, so that call sites can stay free of error handling:
 *
 *  - an error response is shown once, by the layer, and the call rejects with
 *    `HandledHttpError` — the caller's code after `await fetch()` never runs;
 *  - a status listed in `handles` is the caller's, untouched;
 *  - a lost connection holds requests behind one dialog: reads are re-sent by
 *    themselves, writes only when the user says so, and Cancel rejects them;
 *  - every API request says which version sent it, and every response's
 *    version is checked.
 */

const toasts = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

type Call = { url: string; method: string; headers: Headers };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
/** An error response the app itself produced: it carries the version header. */
const appError = (status: number, body: ApiErrorBody) => json(status, body, { [APP_VERSION_HEADER]: APP_VERSION });

/**
 * A fake network. `respond` answers API calls; `offline()` makes every call
 * fail as a dropped connection would, probes included, until `online()`.
 */
function fakeNetwork(respond: (url: string, init?: RequestInit) => Response = () => appOk()) {
	const calls: Call[] = [];
	let offline = false;
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
		if (offline) throw new TypeError("Failed to fetch");
		if (url === "/api/ping") return new Response(null, { status: 204, headers: { [APP_VERSION_HEADER]: APP_VERSION } });
		return respond(url, init);
	});
	return {
		calls,
		fetchImpl,
		sent: (url: string) => calls.filter((c) => c.url === url),
		offline: () => { offline = true; },
		online: () => { offline = false; },
	};
}
const appOk = (body: unknown = {}) => json(200, body, { [APP_VERSION_HEADER]: APP_VERSION });

let uninstall: (() => void) | undefined;
const onUnauthorized = vi.fn();

function install(network: ReturnType<typeof fakeNetwork>) {
	vi.stubGlobal("fetch", network.fetchImpl);
	uninstall = installHttpLayer({ onUnauthorized, reportErrors: false, maintenance: { pollScheduleMs: [1], maxWaitMs: 5_000 } });
	configureConnection({ scheduleMs: [5] });
}

const rejection = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a rejection"); }, (e: unknown) => e);

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => {
	uninstall?.();
	uninstall = undefined;
	resetConnection();
	resetVersionState();
	setTranslator(null);
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe("error responses", () => {
	it("shows the server's message once and rejects, so the caller's next line never runs", async () => {
		const network = fakeNetwork(() => appError(403, { error: "You can't edit someone else's post.", code: "post_not_owned" }));
		install(network);

		const error = await rejection(fetch("/api/posts/1", { method: "PUT" }));
		expect(error).toBeInstanceOf(HandledHttpError);
		expect(error).toMatchObject({ status: 403, message: "You can't edit someone else's post." });
		expect(toasts.warning).toHaveBeenCalledTimes(1);
		expect(toasts.warning.mock.calls[0][0]).toBe("You can't edit someone else's post.");
	});

	it("lets the app translate a server message by its code", async () => {
		install(fakeNetwork(() => appError(403, { error: "You can't edit someone else's post.", code: "post_not_owned" })));
		setTranslator((key) => (key === "error.post_not_owned" ? "Não podes editar o artigo de outra pessoa." : undefined));

		await rejection(fetch("/api/posts/1"));
		expect(toasts.warning.mock.calls[0][0]).toBe("Não podes editar o artigo de outra pessoa.");
	});

	it("hands a status listed in `handles` to the caller, untouched and unannounced", async () => {
		install(fakeNetwork(() => appError(404, { error: "Not found." })));

		const res = await fetch("/api/posts/1", { handles: [404] });
		expect(res.status).toBe(404);
		expect(toasts.warning).not.toHaveBeenCalled();
	});

	it("re-checks the session on a 401", async () => {
		install(fakeNetwork(() => appError(401, { error: "Your session has expired.", code: "unauthenticated" })));

		await rejection(fetch("/api/profile"));
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});

	it("leaves Better Auth's own paths to Better Auth, which reports to its forms", async () => {
		install(fakeNetwork(() => json(401, { message: "Invalid email or password" })));

		const res = await fetch("/api/auth/sign-in/email", { method: "POST" });
		expect(res.status).toBe(401);
		expect(toasts.warning).not.toHaveBeenCalled();
	});

	it("shows a 5xx as an error, and rejects with its status", async () => {
		install(fakeNetwork(() => appError(500, { error: "Something went wrong on our side.", code: "internal", requestId: "abc" })));

		expect(await rejection(fetch("/api/posts"))).toMatchObject({ status: 500 });
		expect(toasts.error).toHaveBeenCalledTimes(1);
	});
});

describe("what the user is told", () => {
	it("in production, never the cause of an unexpected error — only a reference", () => {
		const body: ApiErrorBody = { error: "Something went wrong on our side.", code: "internal", requestId: "ray-1", debug: { message: "db down" } };
		const shown = describeError(500, body, true, true);
		expect(shown.level).toBe("error");
		expect(shown.message).not.toContain("db down");
		expect(shown.description).toBe("Reference: ray-1");
	});

	it("in production, the server's own message for an anticipated failure", () => {
		expect(describeError(409, { error: "Already taken." }, true, true)).toMatchObject({ message: "Already taken.", level: "warning" });
	});

	it("in production, a generic message when the response did not come from the app", () => {
		// A proxy or firewall's body is not written for our users.
		expect(describeError(403, { error: "Blocked by policy 42" }, false, true).message).toBe("You are not allowed to do that.");
	});

	it("outside production, the real cause", () => {
		const shown = describeError(500, { error: "x", code: "internal", requestId: "ray-1", debug: { message: "db down" } }, true, false);
		expect(shown.description).toContain("db down");
		expect(shown.description).toContain("HTTP 500");
	});

	it("honours the level the server chose", () => {
		expect(describeError(409, { error: "Saved as a draft.", level: "info" }, true, true).level).toBe("info");
	});
});

describe("a lost connection", () => {
	it("holds a read and sends it again by itself once the app is reachable", async () => {
		const network = fakeNetwork(() => appOk({ posts: [] }));
		install(network);
		network.offline();

		const pending = fetch("/api/posts");
		await vi.waitFor(() => expect(connectionStore.get().open).toBe(true));
		network.online();

		expect(await (await pending).json()).toEqual({ posts: [] });
		expect(connectionStore.get().open).toBe(false);
	});

	it("treats the edge's 502 like a lost connection, but not a 502 from the app", async () => {
		let edge = true;
		const network = fakeNetwork(() => (edge ? new Response("Bad gateway", { status: 502 }) : appOk({ ok: 1 })));
		install(network);

		const pending = fetch("/api/posts");
		await vi.waitFor(() => expect(connectionStore.get().open).toBe(true));
		edge = false;
		expect(await (await pending).json()).toEqual({ ok: 1 });
		expect(toasts.error).not.toHaveBeenCalled();
	});

	// The case that matters: a write that failed on the way back may already
	// have been carried out, so only the user may send it again.
	it("holds a write until the user presses Send", async () => {
		const network = fakeNetwork(() => appOk({ saved: true }));
		install(network);
		network.offline();

		const pending = fetch("/api/posts", { method: "POST", body: "{}" });
		await vi.waitFor(() => expect(connectionStore.get().open).toBe(true));
		network.online();
		await vi.waitFor(() => expect(connectionStore.get().phase).toBe("restored"));

		// Restored, and still not sent again.
		await new Promise((r) => setTimeout(r, 20));
		expect(network.sent("/api/posts")).toHaveLength(1);

		retryConnectionNow();
		expect(await (await pending).json()).toEqual({ saved: true });
		expect(network.sent("/api/posts")).toHaveLength(2);
	});

	it("rejects every held request when the user cancels", async () => {
		const network = fakeNetwork();
		install(network);
		network.offline();

		const a = rejection(fetch("/api/a"));
		const b = rejection(fetch("/api/b", { method: "DELETE" }));
		await vi.waitFor(() => expect(connectionStore.get().open).toBe(true));
		cancelHeldRequests();

		expect(await a).toMatchObject({ status: 0, handled: true });
		expect(await b).toMatchObject({ status: 0, handled: true });
		expect(connectionStore.get().open).toBe(false);
	});

	it("lets a caller that handles network failures (`handles: [0]`) see the error itself", async () => {
		const network = fakeNetwork();
		install(network);
		network.offline();

		expect(await rejection(fetch("/api/a", { handles: [0] }))).toBeInstanceOf(TypeError);
		expect(connectionStore.get().open).toBe(false);
	});
});

describe("versions", () => {
	it("tells the server which version sent an API request, and leaves other requests alone", async () => {
		const network = fakeNetwork();
		install(network);

		await fetch("/api/posts");
		await fetch("/assets/logo.svg");
		expect(network.sent("/api/posts")[0].headers.get(CLIENT_VERSION_HEADER)).toBe(APP_VERSION);
		expect(network.sent("/assets/logo.svg")[0].headers.has(CLIENT_VERSION_HEADER)).toBe(false);
	});

	it("offers the update once, and after 'Later' never again", async () => {
		let version = "99.0.0";
		install(fakeNetwork(() => json(200, {}, { [APP_VERSION_HEADER]: version })));

		await fetch("/api/posts");
		expect(updateStore.get()).toEqual({ status: "available", serverVersion: "99.0.0" });

		postponeUpdate();
		version = "99.0.1";
		await fetch("/api/posts");
		expect(updateStore.get().status).toBe("pending");
	});

	it("does nothing while the server runs the same version", async () => {
		install(fakeNetwork());
		await fetch("/api/posts");
		expect(updateStore.get().status).toBe("current");
	});
});

describe("client error reports", () => {
	const sent: string[] = [];
	beforeEach(() => {
		sent.length = 0;
		resetReporter((body) => sent.push(body));
	});
	afterEach(() => resetReporter(null));

	it("sends each distinct error once per page", () => {
		for (let i = 0; i < 50; i++) reportClientError({ kind: "error", message: "TypeError: x is undefined" });
		expect(pendingReports()).toHaveLength(1);
	});

	it("stops at the per-page cap, however many distinct errors there are", () => {
		for (let i = 0; i < 100; i++) reportClientError({ kind: "error", message: `error ${i}` });
		expect(pendingReports()).toHaveLength(25);
	});

	it("sends in batches the server accepts", () => {
		for (let i = 0; i < 25; i++) reportClientError({ kind: "error", message: `error ${i}` });
		flushReports();
		flushReports();
		flushReports();
		expect(sent.map((b) => (JSON.parse(b) as { reports: unknown[] }).reports.length)).toEqual([10, 10, 5]);
	});

	it("truncates what it sends", () => {
		reportClientError({ kind: "error", message: "x".repeat(5_000) });
		expect(pendingReports()[0].message).toHaveLength(1_000);
	});
});
