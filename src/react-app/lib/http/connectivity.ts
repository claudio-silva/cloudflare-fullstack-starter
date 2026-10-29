import { APP_VERSION_HEADER, MAINTENANCE_HEADER } from "../../../shared/http-contract";
import { browser } from "./browser";
import { getMaintenanceState, MAINTENANCE_PROBE_PATH, subscribeToMaintenance } from "./maintenance";
import { createStore } from "./store";

/**
 * Whether the app can reach its server, and what happens to requests while it
 * cannot.
 *
 * Applies to every same-origin request, whether or not its caller knows about
 * the HTTP layer: holding a request while the network is gone changes when its
 * caller hears back, never what it hears. (Statuses are another matter — see
 * lib/http/interceptor.ts.)
 *
 * **Detection.** The browser's `offline` event is trusted: with no network
 * interface up, nothing can get through. Its `online` event is not — a Wi-Fi
 * with no internet, a hotel portal or a server that is down all look "online"
 * — so it only brings the next attempt forward. What decides is a request that
 * actually reaches the server.
 *
 * **While offline**, a request is first offered to the app's offline handlers
 * (`addOfflineHandler`), which may answer it from data kept locally. One that
 * none answers waits in line without being sent: only the oldest goes out, and
 * it is the check. When it gets through, the rest follow in the order they
 * were made — writes rely on that — each with the `Idempotency-Key` it was
 * first sent with, so a write that had already reached the server can be
 * recognised as a repeat.
 *
 * **States.** `online`; `offline`; `reconnecting`, while the line that built
 * up is being sent (new requests join its end rather than go to the offline
 * handlers: the server is known to answer); `maintenance`, which takes
 * precedence over the others. The `app:online`, `app:offline` and
 * `app:maintenance` window events announce settled changes only: `online`
 * fires once everything held when the connection returned has been answered,
 * never on the way, so a failure while sending the line goes back to
 * `offline` without anything having been announced.
 *
 * **A request that fails on its own.** A browser extension, a CSP rule or a
 * proxy blocking one URL fails the request exactly as a lost network would.
 * When the browser says it is online, the server is asked (`/api/ping`)
 * before believing it: if the server answers, the request gets its own error,
 * and nothing is held behind it.
 */

export type Connectivity = "online" | "reconnecting" | "offline" | "maintenance";

export type ConnectivityState = {
	state: Connectivity;
	/** Requests waiting for the connection to return. */
	held: number;
	/** `waiting-for-network`: the browser reports no network, so nothing is tried until it does. */
	phase: "waiting" | "waiting-for-network" | "checking";
	/** Seconds until the next attempt, in the `waiting` phase. */
	nextAttemptIn: number;
};

/**
 * Answers a request from data kept locally (IndexedDB, localStorage…) while
 * the server cannot be reached, or returns `undefined` to pass it on. Handlers
 * are asked in the order they were added; the first response wins.
 *
 * A write answered here is the app's from then on: the layer will not send it
 * when the connection returns. Keep it in an outbox and send it from
 * `beforeReconnect`, or on the `app:online` event.
 */
export type OfflineHandler = (request: Request) => Response | undefined | Promise<Response | undefined>;

/** Runs when the server answers again, before any held request is sent. */
export type ReconnectHook = () => void | Promise<void>;

/** Marks a response that an offline handler produced. */
export const OFFLINE_HEADER = "X-Offline";

export type Outcome = { response: Response } | { error: unknown };

/** What the interceptor hands over for each request. */
export type Exchange = {
	/** Send the request (again). Never rejects: failures are outcomes too. */
	send: (signal?: AbortSignal) => Promise<Outcome>;
	/** Whether an outcome means the server could not be reached. */
	stillDown: (outcome: Outcome) => boolean;
	/** The request as offline handlers see it: a fresh copy on every call. */
	request: () => Request;
	signal?: AbortSignal | null;
};

/** The edge answering for an app it could not reach, rather than the app itself. */
export function isUnreachable(response: Response): boolean {
	const status = response.status;
	const gateway = status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 527);
	return gateway && !response.headers.has(APP_VERSION_HEADER) && !response.headers.has(MAINTENANCE_HEADER);
}

const INITIAL: ConnectivityState = { state: "online", held: 0, phase: "waiting", nextAttemptIn: 0 };
export const connectivityStore = createStore<ConnectivityState>(INITIAL);

type Network = "online" | "reconnecting" | "offline";
type Waiter = {
	send: Exchange["send"];
	stillDown: Exchange["stillDown"];
	signal?: AbortSignal | null;
	/** What the request got last time, which is what a cancel hands back. */
	last: Outcome;
	resolve: (result: { outcome: Outcome; cancelled?: boolean }) => void;
};

/** Insertion order is the order the requests were made. */
const waiters = new Set<Waiter>();
const offlineHandlers: OfflineHandler[] = [];
const reconnectHooks = new Set<ReconnectHook>();
const listeners = new Set<(state: Connectivity, previous: Connectivity) => void>();

let network: Network = "online";
/** Read through a call, so TypeScript does not narrow it across an `await` that may change it. */
const isBack = () => network === "online";
/** The last state announced with an `app:*` event. */
let announced: Exclude<Connectivity, "reconnecting"> = "online";
let monitor: Promise<void> | null = null;
let attemptNow = false;
let wake: () => void = () => undefined;
let rawFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

let options = {
	/** Backoff between attempts: quick at first, then settles. */
	scheduleMs: [3_000, 5_000, 10_000, 20_000, 30_000],
	/** Asked whether the server answers, when no held request can be the check. */
	probePath: MAINTENANCE_PROBE_PATH,
};

export function configureConnectivity(next: Partial<typeof options>): void {
	options = { ...options, ...next };
}

const browserOffline = () => browser.navigator?.onLine === false;

function current(): Connectivity {
	return getMaintenanceState().active ? "maintenance" : network;
}

function publish(patch: Partial<ConnectivityState> = {}): void {
	const previous = connectivityStore.get();
	const state = current();
	connectivityStore.set({ ...previous, ...patch, state, held: waiters.size });
	if (state !== previous.state) for (const listener of listeners) listener(state, previous.state);

	// Settled states only: `reconnecting` is on the way to `online`, and may not get there.
	if (state === "reconnecting" || state === announced) return;
	const from = announced;
	announced = state;
	if (typeof CustomEvent === "function") {
		browser.dispatchEvent?.(new CustomEvent(`app:${state}`, { detail: { previous: from } }));
	}
}

function setNetwork(next: Network): void {
	network = next;
	publish();
}

let probe: Promise<boolean> | null = null;

/** Does the server answer? Shared, so a burst of failures costs one round trip. */
function serverAnswers(): Promise<boolean> {
	probe ??= rawFetch(options.probePath, { method: "GET", cache: "no-store", redirect: "manual" })
		// Any answer of the app's own counts — a maintenance 503 or the emergency redirect included.
		.then((response) => !isUnreachable(response), () => false)
		.finally(() => {
			probe = null;
		});
	return probe;
}

/** Is a failed outcome the connection, or the request itself? */
async function connectionIsDown(outcome: Outcome): Promise<boolean> {
	if ("response" in outcome) return true;
	return browserOffline() || !(await serverAnswers());
}

export async function askOfflineHandlers(request: () => Request): Promise<Response | undefined> {
	for (const handler of [...offlineHandlers]) {
		let response: Response | undefined;
		try {
			response = await handler(request());
		} catch (error) {
			// One broken handler must not stop the others, nor fail the request.
			console.error("[http] offline handler failed", error);
			continue;
		}
		if (!response) continue;
		const headers = new Headers(response.headers);
		headers.set(OFFLINE_HEADER, "1");
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
	}
	return undefined;
}

/**
 * Send the request; if maintenance begins while it is held there, the offline
 * handlers get to answer it instead. It was refused or never sent, so dropping
 * it is safe.
 */
async function sendWatchingMaintenance(exchange: Exchange): Promise<Outcome> {
	if (offlineHandlers.length === 0) return exchange.send();
	const controller = new AbortController();
	const onAbort = () => controller.abort(exchange.signal?.reason);
	exchange.signal?.addEventListener("abort", onAbort, { once: true });
	let asked = false;
	let stop: () => void = () => undefined;
	const local = new Promise<Outcome>((resolve) => {
		stop = subscribeToMaintenance(({ active }) => {
			if (!active || asked) return;
			asked = true;
			void askOfflineHandlers(exchange.request).then((response) => {
				if (!response) return;
				controller.abort();
				resolve({ response });
			});
		});
	});
	try {
		return await Promise.race([exchange.send(controller.signal), local]);
	} finally {
		stop();
		exchange.signal?.removeEventListener("abort", onAbort);
	}
}

/** Wait in line. Resolves with the outcome that got through, or the last one on cancel. */
function hold(exchange: Exchange, last: Outcome): Promise<{ outcome: Outcome; cancelled?: boolean }> {
	return new Promise((resolve, reject) => {
		const { signal } = exchange;
		if (signal?.aborted) return reject(signal.reason);
		const onAbort = () => {
			waiters.delete(waiter);
			publish();
			reject(signal?.reason);
		};
		const waiter: Waiter = {
			send: exchange.send,
			stillDown: exchange.stillDown,
			signal,
			last,
			resolve: (result) => {
				signal?.removeEventListener("abort", onAbort);
				resolve(result);
			},
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		waiters.add(waiter);
		publish();
		startMonitor();
	});
}

/** What a request that was never sent gets if it is cancelled: what `fetch` would have said. */
const NEVER_SENT: Outcome = { error: new TypeError("Failed to fetch") };

/**
 * Get a request through, holding it while the server cannot be reached.
 * `cancelled` means the user gave up; `outcome` is then the last failure.
 */
export async function exchange(request: Exchange): Promise<{ outcome: Outcome; cancelled?: boolean }> {
	// Known to be offline: answer locally, or wait in line without sending.
	if (network === "offline") {
		const response = await askOfflineHandlers(request.request);
		return response ? { outcome: { response } } : hold(request, NEVER_SENT);
	}
	// A line is being sent, or still waiting: join its end, so order is kept.
	if (network === "reconnecting" || waiters.size > 0) return hold(request, NEVER_SENT);

	if (getMaintenanceState().active) {
		const response = await askOfflineHandlers(request.request);
		if (response) return { outcome: { response } };
	}

	const outcome = await sendWatchingMaintenance(request);
	if (!request.stillDown(outcome) || !(await connectionIsDown(outcome))) return { outcome };

	if (network === "online") setNetwork("offline");
	startMonitor();
	const response = await askOfflineHandlers(request.request);
	return response ? { outcome: { response } } : hold(request, outcome);
}

/** Sleep that "Try now", the `online` event and Cancel can cut short. `null`: until woken. */
function pause(ms: number | null): Promise<void> {
	return new Promise((resolve) => {
		const timer = ms === null ? undefined : setTimeout(resolve, ms);
		wake = () => {
			clearTimeout(timer);
			resolve();
		};
	});
}

async function waitForTurn(attempt: number): Promise<void> {
	wait: for (;;) {
		if (attemptNow || isBack()) break;
		if (browserOffline()) {
			// Nothing can get through: wait for the browser to see a network.
			publish({ phase: "waiting-for-network", nextAttemptIn: 0 });
			await pause(null);
			continue;
		}
		const delay = options.scheduleMs[Math.min(attempt, options.scheduleMs.length - 1)];
		for (let left = delay; left > 0; left -= 1000) {
			publish({ phase: "waiting", nextAttemptIn: Math.ceil(left / 1000) });
			await pause(Math.min(1000, left));
			if (attemptNow || isBack()) break wait;
			if (browserOffline()) continue wait;
		}
		break;
	}
	attemptNow = false;
}

async function runReconnectHooks(): Promise<void> {
	for (const hook of [...reconnectHooks]) {
		try {
			await hook();
		} catch (error) {
			console.error("[http] beforeReconnect hook failed", error);
		}
	}
}

/**
 * One attempt to get back online. With reconnect hooks, the server is asked
 * first and the hooks run before anything held is sent; without, the oldest
 * held request is the check. True when everything held has been answered.
 */
async function reconnect(): Promise<boolean> {
	if (reconnectHooks.size > 0 || waiters.size === 0) {
		if (!(await serverAnswers())) return false;
		setNetwork("reconnecting");
		await runReconnectHooks();
	}
	// What was held when the connection returned. Once all of it has been
	// answered, the app is online — even if requests made since are still in
	// line, or an app that keeps polling could hold `online` back for ever.
	const line = new Set(waiters);
	for (let waiter = first(); waiter; waiter = first()) {
		const outcome = await waiter.send(waiter.signal ?? undefined);
		if (!waiters.has(waiter)) {
			line.delete(waiter); // cancelled or aborted meanwhile
			continue;
		}
		waiter.last = outcome;
		if (waiter.stillDown(outcome) && (await connectionIsDown(outcome))) {
			setNetwork("offline");
			return false;
		}
		// Through — or failed for a reason of its own, which is the caller's
		// to hear. Either way the line moves on.
		waiters.delete(waiter);
		line.delete(waiter);
		waiter.resolve({ outcome });
		if (network === "offline") setNetwork("reconnecting");
		if (line.size === 0 && network !== "online") setNetwork("online");
		else publish();
	}
	if (network !== "online") setNetwork("online");
	return true;
}

const first = (): Waiter | undefined => waiters.values().next().value;

function startMonitor(): void {
	monitor ??= (async () => {
		let attempt = 0;
		while (!isBack()) {
			await waitForTurn(attempt);
			if (isBack()) break;
			publish({ phase: "checking", nextAttemptIn: 0 });
			attempt = (await reconnect()) ? 0 : attempt + 1;
		}
	})().finally(() => {
		monitor = null;
		publish({ phase: "waiting", nextAttemptIn: 0 });
	});
}

/** Wire up the browser's network events. Returns an uninstall, for tests. */
export function installConnectivity(fetchImpl: typeof fetch): () => void {
	rawFetch = fetchImpl;
	const onOffline = () => {
		if (network === "online") setNetwork("offline");
		startMonitor();
		wake();
	};
	const onOnline = () => {
		if (!monitor) return;
		attemptNow = true;
		wake();
	};
	browser.addEventListener?.("offline", onOffline);
	browser.addEventListener?.("online", onOnline);
	const stopWatchingMaintenance = subscribeToMaintenance(() => publish());
	if (browserOffline()) {
		// Offline from the start: nothing to announce, there was no change.
		network = "offline";
		announced = "offline";
		publish();
		startMonitor();
	}
	return () => {
		browser.removeEventListener?.("offline", onOffline);
		browser.removeEventListener?.("online", onOnline);
		stopWatchingMaintenance();
		resetConnectivity();
	};
}

// ── The app's side ──────────────────────────────────────────────────────────

/** Whether the server can be reached and nothing is held. */
export const isOnline = (): boolean => current() === "online";
export const getConnectivity = (): Connectivity => current();

/** Called on every change of state, `reconnecting` included. Returns an unsubscribe. */
export function subscribeToConnectivity(listener: (state: Connectivity, previous: Connectivity) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Returns a function that removes it. */
export function addOfflineHandler(handler: OfflineHandler): () => void {
	offlineHandlers.push(handler);
	return () => {
		const index = offlineHandlers.indexOf(handler);
		if (index >= 0) offlineHandlers.splice(index, 1);
	};
}

/**
 * Run `hook` when the server answers again, before anything held is sent —
 * the place to send an outbox, so that held requests that depend on it find
 * it there. Also runs at the end of a maintenance window. Returns a function
 * that removes it.
 */
export function beforeReconnect(hook: ReconnectHook): () => void {
	reconnectHooks.add(hook);
	return () => reconnectHooks.delete(hook);
}

/** For the maintenance layer, which releases its own held requests. */
export const runBeforeReconnect = runReconnectHooks;

/** "Try now": skip the rest of the countdown. */
export function retryNow(): void {
	if (connectivityStore.get().phase === "checking") return;
	attemptNow = true;
	wake();
}

/**
 * Give up on every held request. Callers that know the layer get a
 * `HandledHttpError`; others get what `fetch` would have given them.
 */
export function cancelHeld(): void {
	for (const waiter of [...waiters]) {
		waiters.delete(waiter);
		waiter.resolve({ outcome: waiter.last, cancelled: true });
	}
	publish();
}

/** For tests. */
export function resetConnectivity(): void {
	cancelHeld();
	offlineHandlers.length = 0;
	reconnectHooks.clear();
	listeners.clear();
	network = "online";
	announced = "online";
	attemptNow = false;
	wake();
	connectivityStore.set(INITIAL);
}
