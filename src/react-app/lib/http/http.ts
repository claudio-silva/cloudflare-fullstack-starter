import {
	addOfflineHandler,
	beforeReconnect,
	cancelHeld,
	getConnectivity,
	isOnline,
	retryNow,
	subscribeToConnectivity,
	type Connectivity,
} from "./connectivity";

/**
 * `fetch`, opted in to the HTTP layer (lib/http/interceptor.ts). Use it for
 * every call to the app's own API:
 *
 *   const res = await http("/api/posts");              // errors handled for you
 *   const res = await http(url, { handles: [404] });   // a 404 is yours
 *
 * All it does is give `handles` a default of `[]` — "managed, and I handle no
 * status myself" — so call sites need no ceremony. `handles: null` opts the
 * call out again, for when that depends on a condition.
 *
 * It also carries the connection's state, and the app's hooks into it
 * (lib/http/connectivity.ts):
 *
 *   if (!http.online) showOfflineHint();
 *   http.subscribe((state, previous) => setIndicator(state));
 *   http.addOfflineHandler(async (req) => (await cachedResponse(req)) ?? undefined);
 *   http.beforeReconnect(() => sendOutbox());
 *
 * The `app:online`, `app:offline` and `app:maintenance` window events say the
 * same as `http.online` at the moment they fire: the state changes first.
 */
function request(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
	return fetch(input, { ...init, handles: init.handles === undefined ? [] : init.handles });
}

type Http = typeof request & {
	/**
	 * The server can be reached and nothing is held. Not `navigator.onLine`,
	 * which only says that a network interface is up.
	 */
	readonly online: boolean;
	/** `online`, `reconnecting` (sending what was held), `offline` or `maintenance`. */
	readonly state: Connectivity;
	/** Every change of `state`, `reconnecting` included. Returns an unsubscribe. */
	subscribe: typeof subscribeToConnectivity;
	addOfflineHandler: typeof addOfflineHandler;
	beforeReconnect: typeof beforeReconnect;
	/** Try the held requests now, rather than at the end of the countdown. */
	retryNow: typeof retryNow;
	/** Give up on every held request. */
	cancelHeld: typeof cancelHeld;
};

export const http = Object.defineProperties(request, {
	online: { get: isOnline, enumerable: true },
	state: { get: getConnectivity, enumerable: true },
	subscribe: { value: subscribeToConnectivity },
	addOfflineHandler: { value: addOfflineHandler },
	beforeReconnect: { value: beforeReconnect },
	retryNow: { value: retryNow },
	cancelHeld: { value: cancelHeld },
}) as Http;
