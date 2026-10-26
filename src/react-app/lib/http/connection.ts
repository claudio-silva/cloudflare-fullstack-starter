import { createStore } from "./store";

/**
 * Riding out a lost connection: a network failure, or the edge answering that
 * it could not reach the app (502, 503, 504, 52x without our version header).
 *
 * The failed requests are held, not failed, behind one dialog that counts down
 * to the next attempt. There is no separate "is it back?" endpoint: the held
 * requests themselves are sent again, oldest first, and the first one is the
 * check. If it gets through, the app is reachable and it has already done its
 * job, so the rest follow in order; if not, everything waits for the next
 * attempt. The user never has to repeat what they did, nor confirm it.
 *
 * Writes are sent again too. One that failed on the way *back* may already
 * have been carried out; every write the layer sends carries an
 * `Idempotency-Key` that stays the same across these retries, so an endpoint
 * where a duplicate matters (a payment, an order) can recognise it.
 *
 * Unlike maintenance, which is known to end, a lost connection may not come
 * back — so this dialog, unlike the maintenance banner, offers a way out:
 * Cancel fails every held request with a `HandledHttpError`.
 */

export type ConnectionPhase = "waiting" | "checking";
export type ConnectionState = {
	open: boolean;
	phase: ConnectionPhase;
	/** Seconds until the next attempt, in the `waiting` phase. */
	nextAttemptIn: number;
};

const CLOSED: ConnectionState = { open: false, phase: "waiting", nextAttemptIn: 0 };
export const connectionStore = createStore<ConnectionState>(CLOSED);

type Waiter = {
	/** Send the request once more. Never rejects: failures are results too. */
	send: () => Promise<unknown>;
	/** Whether a result means the app is still out of reach. */
	stillDown: (result: unknown) => boolean;
	resolve: (result: unknown) => void;
};

/** Insertion order is the order the requests were made, which writes rely on. */
const waiters = new Set<Waiter>();
let loop: Promise<void> | null = null;
let attemptNow = false;
let wake: () => void = () => undefined;

let options = {
	/** Backoff between attempts: quick at first, then settles. */
	scheduleMs: [3_000, 5_000, 10_000, 20_000, 30_000],
};

export function configureConnection(next: Partial<typeof options>): void {
	options = { ...options, ...next };
}

function publish(patch: Partial<ConnectionState> = {}): void {
	const current = connectionStore.get();
	connectionStore.set(waiters.size === 0 && !loop ? CLOSED : { ...current, open: true, ...patch });
}

/** Sleep that "Try now" and "Cancel" can cut short. */
function pause(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		wake = () => {
			clearTimeout(timer);
			resolve();
		};
	});
}

/** Send the held requests again, oldest first. False if the first that fails is still out of reach. */
async function attemptAll(): Promise<boolean> {
	for (const waiter of [...waiters]) {
		if (!waiters.has(waiter)) continue; // cancelled or aborted meanwhile
		const result = await waiter.send();
		if (!waiters.has(waiter)) continue;
		if (waiter.stillDown(result)) return false;
		waiters.delete(waiter);
		waiter.resolve(result);
	}
	return true;
}

async function run(): Promise<void> {
	let attempt = 0;
	while (waiters.size > 0) {
		const delay = options.scheduleMs[Math.min(attempt, options.scheduleMs.length - 1)];
		for (let left = delay; left > 0; left -= 1000) {
			publish({ phase: "waiting", nextAttemptIn: Math.ceil(left / 1000) });
			await pause(Math.min(1000, left));
			if (attemptNow || waiters.size === 0) break;
		}
		attemptNow = false;
		if (waiters.size === 0) break;

		publish({ phase: "checking", nextAttemptIn: 0 });
		attempt = (await attemptAll()) ? 0 : attempt + 1;
	}
}

/**
 * Hold a request whose last result left the app out of reach. `send` is
 * called on every attempt; the promise resolves with the first result that is
 * not `stillDown`, or with "cancel" when the user gives up.
 */
export function awaitConnection<T>(
	send: () => Promise<T>,
	stillDown: (result: T) => boolean,
	signal?: AbortSignal | null,
): Promise<T | "cancel"> {
	return new Promise<T | "cancel">((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const onAbort = () => {
			waiters.delete(waiter);
			publish();
			reject(signal?.reason);
		};
		const waiter: Waiter = {
			send,
			stillDown: stillDown as (result: unknown) => boolean,
			resolve: (result) => {
				signal?.removeEventListener("abort", onAbort);
				resolve(result as T | "cancel");
			},
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		waiters.add(waiter);

		loop ??= run().finally(() => {
			loop = null;
			publish();
		});
		publish();
	});
}

/** "Try now", or Enter: skip the rest of the countdown. */
export function retryConnectionNow(): void {
	if (connectionStore.get().phase === "checking") return;
	attemptNow = true;
	wake();
}

export function cancelHeldRequests(): void {
	for (const waiter of [...waiters]) {
		waiters.delete(waiter);
		waiter.resolve("cancel");
	}
	wake();
	publish();
}

/** For tests. */
export function resetConnection(): void {
	cancelHeldRequests();
	attemptNow = false;
	connectionStore.set(CLOSED);
}
