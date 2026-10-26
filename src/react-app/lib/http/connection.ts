import { createStore } from "./store";

/**
 * Riding out a lost connection: a network failure, or the edge answering that
 * it could not reach the app (502, 503, 504, 52x without our version header).
 *
 * The failed requests are held, not failed. One dialog says what is going on
 * and counts down to the next check; one shared check — not one per request —
 * asks `/api/ping` whether the app is reachable again. Then:
 *
 *  - reads (GET, HEAD) are sent again by themselves: repeating one is harmless;
 *  - writes wait for the user to press Send. A write that failed on the way
 *    back may already have been carried out, and only the user knows whether
 *    sending it twice matters. Asking is cheap; a duplicate payment is not;
 *  - Cancel fails every held request with a `HandledHttpError`.
 *
 * Unlike maintenance, which is known to end, a lost connection may not come
 * back — so this dialog, unlike the maintenance banner, offers a way out.
 */

export type ConnectionPhase = "waiting" | "checking" | "restored";
export type ConnectionState = {
	open: boolean;
	phase: ConnectionPhase;
	/** Seconds until the next check, in the `waiting` phase. */
	nextAttemptIn: number;
	/** Held writes, which wait for the user once the connection is back. */
	writes: number;
};

const CLOSED: ConnectionState = { open: false, phase: "waiting", nextAttemptIn: 0, writes: 0 };
export const connectionStore = createStore<ConnectionState>(CLOSED);

export type Decision = "retry" | "cancel";
type Waiter = { isRead: boolean; resolve: (decision: Decision) => void };

const waiters = new Set<Waiter>();
let loop: Promise<void> | null = null;
let probeNow = false;
let wake: () => void = () => undefined;

let options = {
	/** True when the app answers at all. */
	probe: async (): Promise<boolean> => false,
	/** Backoff between checks: quick at first, then settles. */
	scheduleMs: [3_000, 5_000, 10_000, 20_000, 30_000],
};

export function configureConnection(next: Partial<typeof options>): void {
	options = { ...options, ...next };
}

function publish(patch: Partial<ConnectionState> = {}): void {
	const current = connectionStore.get();
	const writes = [...waiters].filter((w) => !w.isRead).length;
	connectionStore.set(waiters.size === 0 && !loop ? CLOSED : { ...current, open: true, writes, ...patch });
}

/** Sleep that "Try now", "Send" and "Cancel" can cut short. */
function pause(ms?: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
		wake = () => {
			clearTimeout(timer);
			resolve();
		};
	});
}

function settle(match: (w: Waiter) => boolean, decision: Decision): void {
	for (const w of [...waiters]) {
		if (!match(w)) continue;
		waiters.delete(w);
		w.resolve(decision);
	}
	publish();
}

async function run(): Promise<void> {
	let attempt = 0;
	while (waiters.size > 0) {
		if (connectionStore.get().phase === "restored") {
			await pause(); // until the user decides, or a new failure arrives
			continue;
		}
		const delay = options.scheduleMs[Math.min(attempt, options.scheduleMs.length - 1)];
		for (let left = delay; left > 0; left -= 1000) {
			publish({ phase: "waiting", nextAttemptIn: Math.ceil(left / 1000) });
			await pause(Math.min(1000, left));
			if (probeNow || waiters.size === 0) break;
		}
		probeNow = false;
		if (waiters.size === 0) break;

		publish({ phase: "checking", nextAttemptIn: 0 });
		const up = await options.probe().catch(() => false);
		attempt += 1;
		if (up) {
			settle((w) => w.isRead, "retry");
			if (waiters.size > 0) publish({ phase: "restored" });
			attempt = 0;
		}
	}
}

/**
 * Hold a failed request until the connection is back (or the user gives up).
 * Resolves "retry" when it should be sent again, "cancel" when it should fail.
 */
export function awaitConnection(isRead: boolean, signal?: AbortSignal | null): Promise<Decision> {
	return new Promise<Decision>((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const onAbort = () => {
			waiters.delete(waiter);
			publish();
			reject(signal?.reason);
		};
		const waiter: Waiter = {
			isRead,
			resolve: (decision) => {
				signal?.removeEventListener("abort", onAbort);
				resolve(decision);
			},
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		waiters.add(waiter);

		// A new failure while the dialog says "restored": it is not, after all.
		if (connectionStore.get().phase === "restored") {
			publish({ phase: "waiting" });
			wake();
		}
		loop ??= run().finally(() => {
			loop = null;
			publish();
		});
		publish();
	});
}

/** "Try now" while waiting; "Send" once restored. */
export function retryConnectionNow(): void {
	if (connectionStore.get().phase === "restored") settle(() => true, "retry");
	else probeNow = true;
	wake();
}

export function cancelHeldRequests(): void {
	settle(() => true, "cancel");
	wake();
}

/** For tests. */
export function resetConnection(): void {
	settle(() => true, "cancel");
	wake();
	probeNow = false;
	connectionStore.set(CLOSED);
}
