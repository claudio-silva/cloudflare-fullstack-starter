/**
 * Global handling for "the app is in maintenance".
 *
 * The Worker answers 503 with an `X-Maintenance` header while a deploy with a
 * breaking migration is in flight. Without this, every in-flight call in an
 * open tab would surface as a random failure, and the user would be left
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

export type MaintenanceOptions = {
	/** Polling backoff. Starts responsive, settles down so a long window is cheap. */
	pollScheduleMs?: number[];
	/** Stop replaying after this long and let the error through, rather than hang forever. */
	maxWaitMs?: number;
	/** Exempt in the Worker too, so it answers while everything else is down. */
	probePath?: string;
};

const DEFAULTS = {
	pollScheduleMs: [2_000, 3_000, 5_000, 5_000, 10_000],
	maxWaitMs: 10 * 60 * 1000,
	probePath: "/api/",
};

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
async function waitForRecovery(originalFetch: typeof fetch, opts: Required<MaintenanceOptions>): Promise<boolean> {
	const deadline = Date.now() + opts.maxWaitMs;
	let attempt = 0;
	while (Date.now() < deadline) {
		const delay = opts.pollScheduleMs[Math.min(attempt, opts.pollScheduleMs.length - 1)];
		// Count down in whole seconds so the dialog can show a timer.
		for (let left = delay; left > 0; left -= 1000) {
			nextAttemptIn = Math.ceil(left / 1000);
			emit();
			await sleep(Math.min(1000, left));
		}
		attempt += 1;
		try {
			// The probe goes through the original fetch: routing it through the
			// patched one would re-enter this handler and never terminate.
			const probe = await originalFetch(opts.probePath, { method: "GET", cache: "no-store" });
			if (probe.ok && !isMaintenance(probe)) return true;
		} catch {
			// Network error during a deploy is expected; keep waiting.
		}
	}
	return false;
}

let recovery: Promise<boolean> | null = null;

/**
 * One shared wait for every request caught by the same window.
 *
 * This is what keeps concurrent calls from each starting their own polling
 * loop and hammering a server that is already down: the first 503 creates the
 * wait, everyone else joins it, and they all replay together once it resolves.
 */
function awaitRecovery(originalFetch: typeof fetch, opts: Required<MaintenanceOptions>): Promise<boolean> {
	recovery ??= waitForRecovery(originalFetch, opts).finally(() => {
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

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const response = await originalFetch(input, init);
		if (!isMaintenance(response)) return response;

		if (!active) {
			active = true;
			since = Date.now();
			emit();
		}

		const recovered = await awaitRecovery(originalFetch, opts);
		// Give the caller the real answer, not the 503, so call sites never
		// need to know this happened. If we gave up, the 503 is the honest
		// result and the caller's own error handling takes over.
		if (!recovered) return response;
		return originalFetch(input, init);
	};

	return () => {
		globalThis.fetch = originalFetch;
		installed = false;
		active = false;
		since = null;
		recovery = null;
	};
}
