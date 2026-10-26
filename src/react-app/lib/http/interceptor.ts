import { toast } from "sonner";
import { config } from "../../../config";
import {
	APP_VERSION_HEADER,
	CLIENT_VERSION_HEADER,
	INTERNAL_ERROR_CODE,
	MAINTENANCE_HEADER,
	type AlertLevel,
	type ApiErrorBody,
} from "../../../shared/http-contract";
import { defaultMessages, t, translate, type MessageKey } from "../i18n";
import { browser } from "./browser";
import { awaitConnection } from "./connection";
import { HandledHttpError, isHandledHttpError } from "./handled-error";
import { installMaintenanceInterceptor, MAINTENANCE_PROBE_PATH, type MaintenanceOptions } from "./maintenance";
import { installErrorReporter, reportClientError } from "./reporter";
import { checkOnReturn, CLIENT_VERSION, noteServerVersion, reloadOnStaleChunks } from "./version";

/**
 * The app's HTTP layer: one place where every API call's low-level outcomes
 * are handled the same way, so feature code deals only with its own.
 *
 * **Opt-in, per call.** It patches global `fetch`, but only a same-origin
 * call under `/api/` that has a `handles` key in its options is managed —
 * `handles: []` or `handles: null` is enough, and means "I know about the
 * layer and handle no status myself". A call without the key is passed
 * through untouched (its response's `X-App-Version` is read, nothing more),
 * so code and libraries unaware of the layer behave exactly as without it.
 * The app's own code uses `http()` (lib/http/http.ts), which adds the key.
 *
 * | Outcome                                   | What happens                                             |
 * |-------------------------------------------|----------------------------------------------------------|
 * | Maintenance (either mechanism)            | held and replayed — lib/http/maintenance.ts               |
 * | Network failure, 502/503/504/52x from edge | held behind one dialog and sent again — lib/http/connection.ts |
 * | 4xx                                       | the server's message as a toast (warning, or its `level`) |
 * | 401                                       | the same, and the session is re-checked (sign-in shows)   |
 * | 5xx from the app                          | production: a generic toast with a reference; elsewhere, the real cause |
 * | Any response                              | `X-App-Version` checked — lib/http/version.ts             |
 *
 * After a handled failure, the call **rejects** with `HandledHttpError`: the
 * call site's code simply stops, as it would after an Angular `$http` error,
 * and needs no `if (!res.ok)` for these cases. A caller that handles a status
 * itself lists it, and gets the response as usual:
 *
 *   const res = await http(`/api/posts/${id}`, { handles: [404] });
 *   if (res.status === 404) return showEmptyState();
 *
 * `handles: [0]` takes network failures; `"responses"` every HTTP response
 * (Better Auth's client uses it: its forms show their own errors, while lost
 * connections and maintenance are still ridden out); `"all"` everything.
 */

declare global {
	interface RequestInit {
		/**
		 * Present (even `[]` or `null`): this call is managed by the HTTP layer,
		 * and handles itself only the statuses listed (0 = network failure).
		 * `"responses"`: every HTTP response is the caller's, the layer only rides
		 * out lost connections and maintenance. `"all"`: everything is the caller's.
		 * Absent: the layer leaves the call alone. See lib/http/interceptor.ts.
		 */
		handles?: Handles;
	}
}

export type Handles = number[] | "responses" | "all" | null;

export type HttpLayerOptions = {
	/**
	 * Called on a 401 from a managed path. The starter re-checks the Better
	 * Auth session, which shows the sign-in overlay if it has really expired.
	 */
	onUnauthorized?: () => void;
	/** Off to keep the browser's errors out of the Worker logs. */
	reportErrors?: boolean;
	maintenance?: MaintenanceOptions;
};

const API_PREFIX = "/api/";
const IDEMPOTENCY_HEADER = "Idempotency-Key";
const READS = new Set(["GET", "HEAD"]);

let installed = false;

const isProduction = () => import.meta.env.MODE === "production";

function resolve(input: RequestInfo | URL): URL | null {
	const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	const base = browser.location?.href ?? "http://localhost/";
	try {
		return new URL(raw, base);
	} catch {
		return null;
	}
}

/** The edge answering for an app it could not reach, rather than the app itself. */
function isUnreachable(response: Response): boolean {
	const status = response.status;
	const gateway = status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 527);
	return gateway && !response.headers.has(APP_VERSION_HEADER) && !response.headers.has(MAINTENANCE_HEADER);
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | undefined> {
	if (!response.headers.get("content-type")?.includes("application/json")) return undefined;
	try {
		const body = (await response.clone().json()) as Partial<ApiErrorBody> | null;
		return body && typeof body.error === "string" ? (body as ApiErrorBody) : undefined;
	} catch {
		return undefined;
	}
}

/** What the user is told about an error response. */
export function describeError(
	status: number,
	body: ApiErrorBody | undefined,
	fromApp: boolean,
	production = isProduction(),
): { message: string; level: AlertLevel; description?: string } {
	const level: AlertLevel = body?.level ?? (status >= 500 ? "error" : "warning");
	const known = (`http.${status}` in defaultMessages ? `http.${status}` : status >= 500 ? "http.5xx" : "http.4xx") as MessageKey;

	// The server's own message, unless it is the generic one for an unexpected
	// error: that says nothing the generic client text does not, and in
	// production it is all we have.
	const serverSays = fromApp && body && body.code !== INTERNAL_ERROR_CODE ? body.error : undefined;
	const message = serverSays
		? body?.code
			? translate(`error.${body.code}`, serverSays)
			: serverSays
		: t(status >= 500 ? "http.5xx" : known);

	const reference = body?.requestId ? t("http.reference", { id: body.requestId }) : undefined;
	if (production) return { message, level, description: status >= 500 ? reference : undefined };

	// Outside production, say what actually happened.
	const detail = [`HTTP ${status}${body?.code ? ` · ${body.code}` : ""}${fromApp ? "" : " · not from the app"}`, body?.debug?.message, reference]
		.filter(Boolean)
		.join("\n");
	return { message, level, description: detail };
}

function notify(message: string, level: AlertLevel, description?: string): void {
	// Same text, same toast: a burst of identical failures shows once.
	const show = level === "info" ? toast.info : level === "warning" ? toast.warning : toast.error;
	// pre-line: the development details come one per line.
	show(message, { id: `${level}:${message}`, description, classNames: { description: "whitespace-pre-line" } });
}

/** Install once, before the app renders. Returns an uninstall, for tests. */
export function installHttpLayer(options: HttpLayerOptions = {}): () => void {
	if (installed || typeof globalThis.fetch !== "function") return () => undefined;
	installed = true;

	const rawFetch = globalThis.fetch.bind(globalThis);
	if (options.reportErrors ?? config.http.reportClientErrors) installErrorReporter(rawFetch);

	// Inner layer: maintenance. Requests that reach the code below have already
	// been held through any maintenance window.
	const uninstallMaintenance = installMaintenanceInterceptor(options.maintenance);
	const inner = globalThis.fetch;

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = resolve(input);
		const api = !!url && url.origin === (browser.location?.origin ?? url.origin) && url.pathname.startsWith(API_PREFIX);

		// Not opted in: untouched — not even held through maintenance. Only the
		// version an API response reports is noted, which changes nothing for the caller.
		if (init?.handles === undefined) {
			const response = await rawFetch(input, init);
			if (api) noteServerVersion(response.headers.get(APP_VERSION_HEADER));
			return response;
		}
		if (!api) return inner(input, init);

		const { handles, ...rest } = init;
		const original = typeof input === "object" && !(input instanceof URL) ? input : null;
		const headers = new Headers(rest.headers ?? original?.headers);
		headers.set(CLIENT_VERSION_HEADER, CLIENT_VERSION);
		const method = (rest.method ?? original?.method ?? "GET").toUpperCase();
		// The same key on every retry of this call, so the server can tell a
		// repeat from a new request (see lib/http/connection.ts).
		if (!READS.has(method) && !headers.has(IDEMPOTENCY_HEADER)) headers.set(IDEMPOTENCY_HEADER, crypto.randomUUID());
		const request: RequestInit = { ...rest, headers };

		/** Statuses the caller named, which it takes even when they mean "unreachable". */
		const named = (status: number) => handles === "all" || (Array.isArray(handles) && handles.includes(status));
		const callerHandles = (status: number) => named(status) || (handles === "responses" && status > 0);

		type Attempt = { response: Response } | { error: unknown };
		const send = async (): Promise<Attempt> => {
			try {
				// A Request's body can be read once: send a copy, keep the original for a retry.
				return { response: await inner(original ? original.clone() : input, request) };
			} catch (error) {
				return { error };
			}
		};
		const aborted = (error: unknown) => rest.signal?.aborted || (error instanceof DOMException && error.name === "AbortError");
		const stillDown = (attempt: Attempt) =>
			"error" in attempt
				? !aborted(attempt.error) && !named(0)
				: isUnreachable(attempt.response) && !named(attempt.response.status);

		let attempt = await send();
		if (stillDown(attempt)) {
			const held = await awaitConnection(send, stillDown, rest.signal);
			if (held === "cancel") {
				throw new HandledHttpError(t("connection.cancelled"), "response" in attempt ? attempt.response.status : 0);
			}
			attempt = held;
		}
		if ("error" in attempt) throw attempt.error;
		const response = attempt.response;

		noteServerVersion(response.headers.get(APP_VERSION_HEADER));
		if (response.status < 400 || callerHandles(response.status)) return response;

		const fromApp = response.headers.has(APP_VERSION_HEADER);
		const body = await readErrorBody(response);
		if (response.status >= 500 || !fromApp) {
			// The Worker logged its own 5xx; these are for the ones it never saw,
			// and to tie a server error to the page and version that hit it.
			reportClientError({
				kind: "http",
				message: body?.debug?.message ?? body?.error ?? `HTTP ${response.status}`,
				request: { method, url: url.pathname + url.search, status: response.status, requestId: body?.requestId },
			});
		}
		if (!isProduction()) console.error(`[http] ${method} ${url.pathname} → ${response.status}`, body ?? response);

		const { message, level, description } = describeError(response.status, body, fromApp);
		notify(message, level, description);
		if (response.status === 401) options.onUnauthorized?.();
		throw new HandledHttpError(message, response.status, body);
	};

	// An API call whose failure was already shown and that nobody caught is
	// the normal case now, not a crash.
	const silenceHandled = (event: PromiseRejectionEvent) => {
		if (isHandledHttpError(event.reason)) event.preventDefault();
	};
	addEventListener("unhandledrejection", silenceHandled);

	const stopChecking = checkOnReturn(() =>
		globalThis.fetch(MAINTENANCE_PROBE_PATH, { method: "GET", cache: "no-store", handles: "all" }),
	);
	reloadOnStaleChunks((error) =>
		reportClientError({ kind: "chunk", message: error instanceof Error ? error.message : "stale chunk" }),
	);

	return () => {
		globalThis.fetch = rawFetch;
		uninstallMaintenance();
		removeEventListener("unhandledrejection", silenceHandled);
		stopChecking();
		installed = false;
	};
}
