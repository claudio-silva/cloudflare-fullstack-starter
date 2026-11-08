import { useSyncExternalStore } from "react";
import { CLIENT_ERRORS_PATH } from "../../../shared/http-contract";
import { browser } from "../http/browser";
import { sendReplay } from "../http/maintenance";
import { SESSION_CHANGED_STATUS, SESSION_ID_HEADER, isSessionChangedBody } from "../../../shared/session-binding";
import { standDownUnloadGuards, type HeldSummary } from "./held-requests";
import { REAUTH_METHODS_KEY, learnSignInMethods, resetLearning } from "./reauth-methods";

/** localStorage key of the last signed-in email: what the re-login dialog shows as the account. */
export const REMEMBERED_EMAIL_KEY = "auth.lastEmail";
/** 401s under these path prefixes never trigger: a wrong password answers 401 there. */
export const SESSION_ENDED_EXEMPT_PREFIXES: readonly string[] = ["/api/auth/sign-in/"];

/** Thrown inside Better Auth's fetch so its session atom keeps the last session. */
export class SessionEndedError extends Error {
	constructor() {
		super("session_ended");
		this.name = "SessionEndedError";
	}
}

/** One-shot `sessionStorage` flag: the page left because another account took over this browser's session. */
export const SESSION_REPLACED_FLAG_KEY = "auth.sessionReplaced";

function defaultFlagStorage(): Storage | null {
	try {
		return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
	} catch {
		return null;
	}
}

/** Reads and clears the flag set by the other-account reload. True at most once per reload. */
export function consumeSessionReplacedFlag(storage: Pick<Storage, "getItem" | "removeItem"> | null = defaultFlagStorage()): boolean {
	try {
		if (!storage || storage.getItem(SESSION_REPLACED_FLAG_KEY) === null) return false;
		storage.removeItem(SESSION_REPLACED_FLAG_KEY);
		return true;
	} catch {
		return false;
	}
}

export type SessionEndedDeps = {
	storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
	/** Per-tab storage for the toast flag (`sessionStorage`); null or absent: no toast. */
	flagStorage?: Pick<Storage, "setItem"> | null;
	replaceLocation: (url: string) => void;
	/** A session was seen for this (same) user: the place to learn how the account signs in. */
	onUserSeen?: (user: { id: string; email: string }) => void;
};

export type SessionEnded = {
	isEnded(): boolean;
	isArmed(): boolean;
	/** Called once per transition (not ended → ended, ended → restored). */
	subscribe(listener: () => void): () => void;
	/** Resolves at the next restore; an already-resolved promise when not ended. Never rejects: a page that is left drops its waiters with the page. */
	whenRestored(): Promise<void>;
	/**
	 * The page is being left on purpose ("Use another account", the forgot-password link, another
	 * account signed in). Sticky: `sessionSeen` and `markEnded` become no-ops, so nothing the page
	 * held can be restored or replayed under any later session. Held requests are not rejected (their
	 * error paths would flash); the navigation drops them.
	 */
	leave(): void;
	/** The page stayed alive (back/forward cache): the restore logic is back. */
	resume(): void;
	rememberedEmail(): string | null;
	/** True once `leave()` (or an other-account reload) froze this page. */
	isLeaving(): boolean;
	/**
	 * The Better Auth `session.id` this tab last saw; null until the first get-session (and after a
	 * sign-out here). Memory only, never persisted. The guard sends it as `X-Session-Id` on every `/api/` request.
	 */
	tabSessionId(): string | null;
	/**
	 * get-session returned a session for this user. Same user: remember the email, and if the session
	 * had ended, restore. Different user: leave, set the toast flag and reload `/`.
	 */
	sessionSeen(user: { id: string; email: string }, sessionId?: string): void;
	/** A sign-out request is leaving this tab. */
	signingOut(): void;
	/** A qualifying 401, or get-session found no session. */
	markEnded(): void;
};

export function createSessionEnded(deps: SessionEndedDeps): SessionEnded {
	const listeners = new Set<() => void>();
	let armedUserId: string | null = null;
	let ended = false;
	let replaced = false;
	let restored: Promise<void> = Promise.resolve();
	let resolveRestored: (() => void) | null = null;
	let leaving = false;
	let tabSessionId: string | null = null;
	const newRestored = (): void => {
		restored = new Promise<void>((resolve) => {
			resolveRestored = resolve;
		});
	};

	const read = (): string | null => {
		try {
			return deps.storage?.getItem(REMEMBERED_EMAIL_KEY) ?? null;
		} catch {
			return null;
		}
	};
	const write = (email: string): void => {
		try {
			if (deps.storage && deps.storage.getItem(REMEMBERED_EMAIL_KEY) !== email) {
				deps.storage.setItem(REMEMBERED_EMAIL_KEY, email);
			}
		} catch {
			// Storage unavailable: behaves as no remembered email.
		}
	};
	const remove = (): void => {
		try {
			deps.storage?.removeItem(REMEMBERED_EMAIL_KEY);
			deps.storage?.removeItem(REAUTH_METHODS_KEY);
		} catch {
			// Storage unavailable.
		}
	};
	const notify = (): void => {
		for (const listener of [...listeners]) listener();
	};

	return {
		isEnded: () => ended,
		isArmed: () => armedUserId !== null,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		whenRestored: () => (ended ? restored : Promise.resolve()),
		leave() {
			leaving = true;
		},
		resume() {
			leaving = false;
		},
		isLeaving: () => leaving,
		tabSessionId: () => tabSessionId,
		rememberedEmail: read,
		sessionSeen(user, sessionId) {
			if (leaving) return;
			write(user.email);
			if (armedUserId !== null && user.id !== armedUserId) {
				// A different account signed in (here or in another tab): nothing on this page may be
				// sent under it. Start clean: the navigation drops the held requests (rejecting them
				// would flash their error paths), and no native prompt may block a forced expulsion.
				// The toast flag is read after the reload.
				standDownUnloadGuards();
				leaving = true;
				try {
					deps.flagStorage?.setItem(SESSION_REPLACED_FLAG_KEY, "1");
				} catch {
					// Storage unavailable: the reload still happens, without the toast.
				}
				deps.replaceLocation("/");
				return;
			}
			// Before the restore below resolves its waiters, so a replay already carries the new id.
			if (sessionId) tabSessionId = sessionId;
			if (ended && user.id === armedUserId) {
				ended = false;
				resolveRestored?.();
				resolveRestored = null;
				notify();
			}
			armedUserId = user.id;
			deps.onUserSeen?.(user);
		},
		signingOut() {
			armedUserId = null;
			tabSessionId = null;
			resetLearning();
			remove();
		},
		markEnded() {
			if (leaving || armedUserId === null) return;
			if (read() === null) {
				// Someone signed out explicitly (here or in another tab): never show the dialog
				// over the previous user's page.
				if (!replaced) {
					replaced = true;
					deps.replaceLocation("/");
				}
				return;
			}
			if (ended) return;
			ended = true;
			newRestored();
			notify();
		},
	};
}

function defaultStorage(): SessionEndedDeps["storage"] {
	try {
		return (globalThis as { localStorage?: Storage }).localStorage ?? null;
	} catch {
		return null;
	}
}

/** This page's state: `localStorage` and `sessionStorage` (null when absent or throwing), `location.replace`. */
const defaultInstance = createSessionEnded({
	storage: defaultStorage(),
	flagStorage: defaultFlagStorage(),
	replaceLocation: (url) => browser.location?.replace(url),
	onUserSeen: (user) => learnSignInMethods(user.email, defaultStorage()),
});

export function getSessionEnded(): SessionEnded {
	return defaultInstance;
}

/** The URL of a fetch input, whichever form it takes. */
export function requestUrl(input: RequestInfo | URL): string {
	return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/**
 * True once the page has fired `pagehide` (reset by `pageshow`, for the back/forward cache). Only
 * then is a keepalive request left unheld: every unload-time sender is a `pagehide` handler and
 * cannot await a replay. While the page is alive, even in a hidden tab, a keepalive write is held
 * and replayed like any other.
 */
let pageLeaving = false;

/** Registers the `pagehide` / `pageshow` listeners on `target`. Call once at load, before the first request. */
export function trackPageLeaving(target: { addEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void }): void {
	target.addEventListener("pagehide", () => void (pageLeaving = true), { capture: true });
	target.addEventListener("pageshow", () => void (pageLeaving = false), { capture: true });
}

/** Best-effort diagnostics are never held: they are not worth a re-login prompt or a discard warning. */
const NEVER_HELD_PREFIXES: readonly string[] = [CLIENT_ERRORS_PATH];

function isKeepalive(input: RequestInfo | URL, init?: RequestInit): boolean {
	// `keepalive` is a browser option: the Workers typings this module is also compiled under omit it.
	return (init as { keepalive?: boolean } | undefined)?.keepalive === true || (typeof Request !== "undefined" && input instanceof Request && input.keepalive);
}

/** A one-shot body cannot be sent twice. A stream is let through unheld; strings, forms and blobs can be replayed. */
function hasReplayableBody(init?: RequestInit): boolean {
	return !(typeof ReadableStream !== "undefined" && init?.body instanceof ReadableStream);
}

export type SessionEndedGuardOptions = {
	/** Number of requests currently held for the re-login (0 when none). */
	onHeldChange?: (count: number, summary: HeldSummary) => void;
	/** Test seam: whether the page is unloading. Defaults to the real page state. */
	isUnloading?: () => boolean;
};

/**
 * A session that ended under an open page: the layer's `guards` entry that holds requests.
 *
 * A same-origin `/api/` request that comes back 401 while the tab is armed (see `markEnded`) is not
 * handed to the caller: this guard opens the dialog, keeps the original `(input, init)` in this
 * closure, waits for the re-login (`whenRestored`) and replays it, so the caller resolves with the
 * replay's response and never sees the 401. Requests made while the tab is ended never reach the
 * network; they join the same wait.
 *
 * Invariants other code relies on:
 *  - A request answered 401 by `authMiddleware` changed nothing: the refusal precedes any handler,
 *    so replaying it is safe.
 *  - `/api/auth/*` is never held: the sign-in and the session refetch are what ends the wait.
 *  - A held request's caller resolves with the replay's response and never sees the 401.
 *
 * Replays use the maintenance interceptor's `sendReplay`: identical reads (polling GETs) merge into
 * one network call and each caller gets its own `clone()`. Writes are never merged and replay one
 * after another, in arrival order; reads go in parallel. At most two rounds per request, after
 * which the last response is returned.
 *
 * Not held: `keepalive` requests sent while the page is unloading (they cannot be awaited across
 * it; before that they are held like any write), the client-error reports, requests with a stream
 * body (one-shot), `/api/auth/*`. Those get their 401 as before, and a qualifying 401 still marks
 * the session ended. If the page is left instead ("Use another account"), `state.leave()` freezes
 * the restore logic and the navigation drops the held requests.
 */
export function withSessionEndedGuard(
	fetchImpl: typeof fetch,
	state: SessionEnded,
	origin: string,
	options: SessionEndedGuardOptions = {},
): typeof fetch {
	const ownOrigin = new URL(origin).origin;
	let heldCount = 0;
	let heldWrites = 0;
	let writeChain: Promise<unknown> = Promise.resolve();
	const addHeld = (delta: number, write: boolean): void => {
		heldCount += delta;
		if (write) heldWrites += delta;
		options.onHeldChange?.(heldCount, { writes: heldWrites });
	};
	const waitRestored = (signal: AbortSignal | null | undefined): Promise<void> => {
		if (!signal) return state.whenRestored();
		if (signal.aborted) return Promise.reject(signal.reason);
		return new Promise<void>((resolve, reject) => {
			const onAbort = () => reject(signal.reason);
			signal.addEventListener("abort", onAbort, { once: true });
			state.whenRestored().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
		});
	};

	/**
	 * Every send of an `/api/` request goes through here, replays included: the tab's session id is
	 * read now, not when the request was queued, so a replay after an adoption carries the new one.
	 * With no id yet there is no header.
	 */
	const send = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const id = state.tabSessionId();
		if (!id) return fetchImpl(input, init);
		const headers = new Headers(init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
		headers.set(SESSION_ID_HEADER, id);
		return fetchImpl(input, { ...init, headers });
	};

	/**
	 * A 409 `session_changed`: the cookie now resolves to another session than the one this tab was
	 * loaded under. One get-session settles it, shared by every request refused at the same time.
	 * "adopted": same account, the tab took the new id (requests that can be replayed are);
	 * "left": another account, the page is reloading to "/" (nothing is replayed, ever);
	 * "ended": no session at all, the ordinary 401 path takes over; "unknown": could not tell.
	 */
	type Outcome = "adopted" | "left" | "ended" | "unknown";
	let resolving: Promise<Outcome> | null = null;
	const resolveSessionChange = (): Promise<Outcome> => {
		resolving ??= (async (): Promise<Outcome> => {
			try {
				const res = await fetchImpl(`${ownOrigin}/api/auth/get-session`);
				if (!res.ok) return "unknown";
				const body = (await res.json()) as { user?: { id?: unknown; email?: unknown }; session?: { id?: unknown } } | null;
				const user = body?.user;
				if (!user) {
					state.markEnded();
					return "ended";
				}
				if (typeof user.id !== "string" || typeof user.email !== "string") return "unknown";
				state.sessionSeen({ id: user.id, email: user.email }, typeof body?.session?.id === "string" ? body.session.id : undefined);
				return state.isLeaving() ? "left" : "adopted";
			} catch {
				return "unknown";
			} finally {
				resolving = null;
			}
		})();
		return resolving;
	};
	const isSessionChanged = async (response: Response): Promise<boolean> => {
		if (response.status !== SESSION_CHANGED_STATUS) return false;
		return isSessionChangedBody(await response.clone().json().catch(() => undefined));
	};
	/** The page is going away; whatever was asked is dropped with it, never answered under another login. */
	const dropped = (): Promise<Response> => new Promise<Response>(() => undefined);

	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		let pathname: string;
		try {
			const url = new URL(requestUrl(input), origin);
			if (url.origin !== ownOrigin || !url.pathname.startsWith("/api/")) return fetchImpl(input, init);
			pathname = url.pathname;
		} catch {
			return fetchImpl(input, init);
		}
		const qualifies = !SESSION_ENDED_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
		if (!qualifies) return fetchImpl(input, init);
		const holdable =
			!pathname.startsWith("/api/auth/") &&
			!NEVER_HELD_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
			!(isKeepalive(input, init) && (options.isUnloading ?? (() => pageLeaving))()) &&
			hasReplayableBody(init);

		if (!holdable) {
			const response = await send(input, init);
			if (await isSessionChanged(response)) {
				// Cannot be replayed (auth route, stream body, unload-time keepalive, diagnostics): adopt or leave, and answer as is.
				if ((await resolveSessionChange()) === "left") return dropped();
			}
			if (response.status === 401) state.markEnded();
			return response;
		}

		// A Request's body is consumed by the first send: keep a clone to replay from.
		const spare = typeof Request !== "undefined" && input instanceof Request ? input.clone() : input;
		const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
		const isRead = method === "GET" || method === "HEAD";
		const replay = (): Promise<Response> => {
			const source = typeof Request !== "undefined" && spare instanceof Request ? spare.clone() : spare;
			if (isRead) return sendReplay(send, source, init);
			const run = writeChain.then(() => send(source, init));
			writeChain = run.catch(() => undefined);
			return run;
		};

		if (!state.isEnded()) {
			let response = await send(input, init);
			let noSession = false;
			if (await isSessionChanged(response)) {
				const outcome = await resolveSessionChange();
				if (outcome === "left") return dropped();
				if (outcome === "unknown") return response;
				if (outcome === "adopted") {
					// Once: the refused request changed nothing (the check runs before any handler).
					response = await replay();
					if (await isSessionChanged(response)) return response;
				} else {
					noSession = true;
				}
			}
			if (response.status !== 401 && !noSession) return response;
			state.markEnded();
			// Not ended after all (signed out on purpose, or storage unavailable): the page is going to "/".
			if (!state.isEnded()) return response;
		}

		addHeld(1, !isRead);
		try {
			let response: Response | undefined;
			for (let attempt = 0; attempt < 2; attempt++) {
				await waitRestored(init?.signal);
				response = await replay();
				if (response.status !== 401) return response;
				state.markEnded();
				if (!state.isEnded()) return response;
			}
			return response as Response;
		} finally {
			addHeld(-1, !isRead);
		}
	};
}

/**
 * Better Auth `customFetchImpl`. Better Auth captures `fetch` when its client is created, which is
 * before `main.tsx` installs the HTTP layer. This looks `fetch` up per request instead, so get-session,
 * sign-in and sign-out pass the layer's chain too.
 */
export function createAuthFetch(state: SessionEnded, getFetch: () => typeof fetch = () => globalThis.fetch): typeof fetch {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const base = browser.location?.origin ?? "http://localhost";
		let pathname = "";
		try {
			pathname = new URL(requestUrl(input), base).pathname;
		} catch {
			// Unparseable: treated as an unrelated path.
		}
		if (pathname === "/api/auth/sign-out") state.signingOut();
		const res = await getFetch()(input, init);
		if (pathname === "/api/auth/get-session" && res.ok) {
			let body: unknown;
			try {
				body = await res.clone().json();
			} catch {
				return res;
			}
			const parsed = body as { user?: { id?: unknown; email?: unknown }; session?: { id?: unknown } } | null;
			const user = parsed?.user;
			if (user && typeof user.id === "string" && typeof user.email === "string") {
				state.sessionSeen({ id: user.id, email: user.email }, typeof parsed?.session?.id === "string" ? parsed.session.id : undefined);
				return res;
			}
			if (!user && state.isArmed()) {
				state.markEnded();
				throw new SessionEndedError();
			}
		}
		return res;
	};
}

/** `useSyncExternalStore` over `getSessionEnded()`. */
export function useSessionEnded(): boolean {
	const state = getSessionEnded();
	return useSyncExternalStore(state.subscribe, state.isEnded);
}
