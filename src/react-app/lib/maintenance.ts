/**
 * Global handling for "the app is in maintenance".
 *
 * A maintenance window reaches an open tab in one of two shapes:
 *
 *  - planned (the `MAINTENANCE` var): the Worker answers 503 with an
 *    `X-Maintenance` header;
 *  - emergency (the zone redirect): the request is redirected to a page on
 *    another origin, and since that page sends no CORS headers, `fetch`
 *    rejects with a bare `TypeError: Failed to fetch`. A network error, as far
 *    as the caller can tell — so on a same-origin network error we ask the
 *    probe, with redirects not followed, whether it is being redirected.
 *
 * Without this, every in-flight call in an open tab would surface as a random
 * failure ("Não foi possível…", "Failed to fetch"), and the user would be left
 * reloading by hand until it happened to work.
 *
 * Instead the request is held: the UI says what is going on, the base URL is
 * polled until the app answers again, and the original request is replayed
 * with the same payload. The caller's promise resolves with the real response,
 * so nothing above this layer has to know maintenance exists.
 *
 * This patches `window.fetch` rather than exposing a wrapper, for the same
 * reason Angular uses an HTTP interceptor: it is the only way to cover calls
 * made by libraries. Better Auth issues its own requests and would otherwise
 * slip past.
 */

const MAINTENANCE_HEADER = "x-maintenance";

/**
 * What the client polls to learn the app is back.
 *
 * NOT `/api/`. That one is exempt from both mechanisms, because the deploy
 * polls it to confirm the release — so it answers 200 throughout the window,
 * and a probe aimed at it reports a recovery that has not happened. The probe
 * has to be down exactly when the app is.
 */
export const MAINTENANCE_PROBE_PATH = "/api/ping";

export type MaintenanceOptions = {
	/** Polling backoff. Starts responsive, settles down so a long window is cheap. */
	pollScheduleMs?: number[];
	/** Stop replaying after this long and let the error through, rather than hang forever. */
	maxWaitMs?: number;
	/** Must be subject to maintenance like any other route — see MAINTENANCE_PROBE_PATH. */
	probePath?: string;
};

const DEFAULTS = {
	/**
	 * Used only when the server sends no `Retry-After`. Ours always does, so
	 * this is the fallback for an unexpected 503: a minute, because a
	 * maintenance window is minutes long and polling every two seconds for
	 * minutes is pure noise against a server that is already busy.
	 */
	pollScheduleMs: [60_000],
	/**
	 * Total budget before giving up and letting the error through. Has to be
	 * comfortably larger than `maxRetryAfterMs`, or a single honoured
	 * `Retry-After` would consume the whole allowance and we would poll once.
	 */
	maxWaitMs: 30 * 60 * 1000,
	probePath: MAINTENANCE_PROBE_PATH,
	/** Clamp for `Retry-After`: honour a long wait, but not an unbounded one. */
	maxRetryAfterMs: 10 * 60 * 1000,
};

/**
 * `Retry-After`, in milliseconds, or null when absent or unusable.
 *
 * The server knows how long the window will be and the client does not, so
 * when it says, we listen — but only within a bound: this value comes over the
 * wire and a mistake in it would otherwise freeze the UI.
 */
export function parseRetryAfterMs(value: string | null, maxMs: number): number | null {
	if (!value) return null;
	const seconds = Number(value.trim());
	if (Number.isFinite(seconds)) {
		if (seconds < 0) return null;
		return Math.min(seconds * 1000, maxMs);
	}
	const date = Date.parse(value);
	if (Number.isNaN(date)) return null;
	return Math.min(Math.max(date - Date.now(), 0), maxMs);
}

export type MaintenanceState = { active: boolean; since: number | null; nextAttemptIn: number };

type Listener = (state: MaintenanceState) => void;

let installed = false;
let active = false;
let since: number | null = null;
let nextAttemptIn = 0;
const listeners = new Set<Listener>();

function snapshot(): MaintenanceState {
	return { active, since, nextAttemptIn };
}

function emit(): void {
	const s = snapshot();
	for (const l of listeners) l(s);
}

export function subscribeToMaintenance(listener: Listener): () => void {
	listeners.add(listener);
	listener(snapshot());
	return () => listeners.delete(listener);
}

export function getMaintenanceState(): MaintenanceState {
	return snapshot();
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function isMaintenance(response: Response): boolean {
	return response.status === 503 && response.headers.has(MAINTENANCE_HEADER);
}

/**
 * Wait for the app to come back, counting down so the UI can show progress.
 * Resolves true when it answers, false when we give up.
 */
async function waitForRecovery(
	originalFetch: typeof fetch,
	opts: Required<MaintenanceOptions>,
	firstDelayMs: number | null,
): Promise<boolean> {
	const deadline = Date.now() + opts.maxWaitMs;
	let attempt = 0;
	while (Date.now() < deadline) {
		const delay =
			attempt === 0 && firstDelayMs !== null
				? firstDelayMs
				: opts.pollScheduleMs[Math.min(attempt, opts.pollScheduleMs.length - 1)];
		// Count down in whole seconds so the dialog can show a timer.
		for (let left = delay; left > 0; left -= 1000) {
			nextAttemptIn = Math.ceil(left / 1000);
			emit();
			await sleep(Math.min(1000, left));
		}
		attempt += 1;
		if ((await probe(originalFetch, opts.probePath)) === "up") return true;
	}
	return false;
}

type ProbeResult = "up" | "maintenance" | "unknown";

/**
 * Ask the app whether it is serving.
 *
 * `redirect: "manual"` is what makes the emergency window visible: followed,
 * the zone redirect ends in a CORS failure indistinguishable from being
 * offline; not followed, it is an `opaqueredirect`, which our probe route
 * never answers with.
 *
 * Goes through the original fetch: routing it through the patched one would
 * re-enter this handler and never terminate.
 */
async function probe(originalFetch: typeof fetch, path: string): Promise<ProbeResult> {
	try {
		const res = await originalFetch(path, { method: "GET", cache: "no-store", redirect: "manual" });
		// Widened: the Workers typings (this module is also compiled for the tests)
		// omit browser-only response types.
		if ((res.type as string) === "opaqueredirect" || isMaintenance(res)) return "maintenance";
		return res.ok ? "up" : "unknown";
	} catch {
		// Offline, or the Worker mid-deploy. Not a verdict either way.
		return "unknown";
	}
}

let diagnosis: Promise<boolean> | null = null;

/**
 * After a same-origin network error: is it the emergency redirect?
 *
 * Shared like the recovery wait, so a burst of failed requests costs one probe
 * rather than one each.
 */
function isRedirectMaintenance(originalFetch: typeof fetch, path: string): Promise<boolean> {
	diagnosis ??= probe(originalFetch, path)
		.then((result) => result === "maintenance")
		.finally(() => {
			diagnosis = null;
		});
	return diagnosis;
}

/**
 * Only our own origin is ours to diagnose. A third-party API failing says
 * nothing about this app's maintenance, and holding its requests would only
 * delay an error the caller should see.
 */
function isSameOrigin(input: RequestInfo | URL): boolean {
	const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	const base = (globalThis as { location?: { href: string } }).location?.href ?? "http://localhost/";
	try {
		return new URL(raw, base).origin === new URL(base).origin;
	} catch {
		return false;
	}
}

let recovery: Promise<boolean> | null = null;

/**
 * One shared wait for every request caught by the same window.
 *
 * This is what keeps concurrent calls from each starting their own polling
 * loop and hammering a server that is already down: the first 503 creates the
 * wait, everyone else joins it, and they all replay together once it resolves.
 */
function awaitRecovery(
	originalFetch: typeof fetch,
	opts: Required<MaintenanceOptions>,
	firstDelayMs: number | null = null,
): Promise<boolean> {
	recovery ??= waitForRecovery(originalFetch, opts, firstDelayMs).finally(() => {
		recovery = null;
		active = false;
		since = null;
		nextAttemptIn = 0;
		emit();
	});
	return recovery;
}

/** Returns a function that restores the original fetch (used by the tests). */
export function installMaintenanceInterceptor(options: MaintenanceOptions = {}): () => void {
	// globalThis rather than window: in a browser they are the same object, and
	// this keeps the module usable (and testable) outside one.
	if (installed || typeof globalThis.fetch !== "function") return () => undefined;
	installed = true;
	const opts = { ...DEFAULTS, ...options };
	const originalFetch = globalThis.fetch.bind(globalThis);

	/** Mark the app as down and start the one shared wait, if not already running. */
	const enterMaintenance = (firstDelayMs: number | null) => {
		if (!active) {
			active = true;
			since = Date.now();
			emit();
		}
		void awaitRecovery(originalFetch, opts, firstDelayMs);
	};

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		if (!isSameOrigin(input)) return originalFetch(input, init);

		// Per request, not per window: a request replayed into a window that
		// opens again must still give up eventually.
		const deadline = Date.now() + opts.maxWaitMs;

		for (;;) {
			// Already known to be down: hold the request without sending it.
			// Only the first failure costs a round trip; everything after it
			// waits, so a server that is already struggling is not asked again
			// until the single polling loop says it has recovered.
			if (active) {
				const recovered = await awaitRecovery(originalFetch, opts);
				// Gave up: one last real attempt, and its result — 503, error or
				// success — goes to the caller untouched. Its own error handling
				// takes over from here.
				if (!recovered || Date.now() >= deadline) return originalFetch(input, init);
			}

			let response: Response;
			try {
				response = await originalFetch(input, init);
			} catch (error) {
				// Either really offline, or the emergency redirect: a request
				// stopped by the redirect never reached the Worker, so holding
				// and replaying it is safe. Anything else is the caller's error.
				if (Date.now() >= deadline || !(await isRedirectMaintenance(originalFetch, opts.probePath))) {
					throw error;
				}
				// The redirect hides its headers, so no Retry-After: the
				// default schedule applies.
				enterMaintenance(null);
				continue;
			}

			// Includes a replay that landed in a window that opened again: it
			// goes back to waiting instead of handing the caller a 503.
			if (!isMaintenance(response) || Date.now() >= deadline) return response;

			// The server said how long to wait; the first poll honours it.
			enterMaintenance(parseRetryAfterMs(response.headers.get("retry-after"), opts.maxRetryAfterMs));
		}
	};

	return () => {
		globalThis.fetch = originalFetch;
		installed = false;
		active = false;
		since = null;
		recovery = null;
		diagnosis = null;
	};
}
