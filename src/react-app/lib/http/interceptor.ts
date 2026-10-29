import { toast } from "sonner";
import { config } from "../../../config";
import {
	APP_VERSION_HEADER,
	CLIENT_OUTDATED_CODE,
	CLIENT_VERSION_HEADER,
	INTERNAL_ERROR_CODE,
	type AlertLevel,
	type ApiErrorBody,
} from "../../../shared/http-contract";
import { defaultMessages, t, translate, type MessageKey } from "../i18n";
import { browser } from "./browser";
import { exchange, installConnectivity, isUnreachable, OFFLINE_HEADER, runBeforeReconnect, type Outcome } from "./connectivity";
import { HandledHttpError, isHandledHttpError } from "./handled-error";
import { installMaintenanceInterceptor, MAINTENANCE_PROBE_PATH, type MaintenanceOptions } from "./maintenance";
import { installErrorReporter, reportClientError } from "./reporter";
import { configureUi, DEFAULT_UI, getUi, type HttpUi } from "./ui";
import { checkOnReturn, CLIENT_VERSION, noteServerVersion, reloadOnStaleChunks, requireUpdate } from "./version";

/**
 * The app's HTTP layer: one place where every API call's low-level outcomes
 * are handled the same way, so feature code deals only with its own.
 *
 * It patches global `fetch` — the only way to also reach requests made by
 * libraries — and draws one line: **what is safe to do for any caller, it
 * does for every caller; what changes what a caller sees, only for callers
 * that asked.**
 *
 * For every same-origin request, whether or not its caller knows the layer:
 *
 * | Outcome                                    | What happens                                       |
 * |--------------------------------------------|----------------------------------------------------|
 * | Maintenance (either mechanism)             | held and replayed — lib/http/maintenance.ts         |
 * | Network failure, 502/503/504/52x from edge | answered by an offline handler, or held and sent again — lib/http/connectivity.ts |
 * | Any API response                           | `X-App-Version` checked — lib/http/version.ts       |
 * | 426 `client_outdated`                      | this tab must update: a dialog without "Postpone"   |
 *
 * Holding a request changes when its caller hears back, never what it hears.
 * Statuses are another matter: a library may well handle a 403 or a 409 of
 * its own, and we cannot know which. So only a call that **opts in** — a
 * `handles` key that is not `null`, which `http()` adds — gets the rest:
 *
 * | Outcome            | What happens                                              |
 * |--------------------|-----------------------------------------------------------|
 * | 4xx                | the server's message as a toast (warning, or its `level`) |
 * | 401                | the same, and the session is re-checked (sign-in shows)    |
 * | 5xx from the app   | production: a generic toast with a reference; elsewhere, the real cause |
 *
 * After a handled failure, the call **rejects** with `HandledHttpError`: the
 * call site's code simply stops, as it would after an Angular `$http` error,
 * and needs no `if (!res.ok)` for these cases. A caller that handles a status
 * itself lists it, and gets the response as usual:
 *
 *   const res = await http(`/api/posts/${id}`, { handles: [404] });
 *   if (res.status === 404) return showEmptyState();
 *
 * `handles: [0]` takes network failures: no holding, no offline handlers, the
 * error as `fetch` gives it. `"all"` takes everything: the layer does nothing
 * to the call, not even during maintenance. `null`, like no key at all, is a
 * caller that does not know the layer — handy to switch it off conditionally.
 */

declare global {
	interface RequestInit {
		/**
		 * Statuses this call handles itself (0 = network failure); the HTTP layer
		 * shows and rejects every other error. `[]`: none. `"all"`: the layer
		 * leaves the call alone entirely. Absent or `null`: a caller unaware of
		 * the layer, which only holds it through lost connections and maintenance.
		 * See lib/http/interceptor.ts.
		 */
		handles?: Handles;
	}
}

export type Handles = number[] | "all" | null;

/** What an error response told the user, for an app that shows errors its own way. */
export type HttpErrorReport = {
	message: string;
	level: AlertLevel;
	description?: string;
	status: number;
	body?: ApiErrorBody;
};

export type HttpLayerOptions = {
	/**
	 * Called on a 401 from a managed path. The starter re-checks the Better
	 * Auth session, which shows the sign-in overlay if it has really expired.
	 */
	onUnauthorized?: () => void;
	/** Called for every error the layer reports; with `ui: { errors: false }`, instead of the toast. */
	onError?: (error: HttpErrorReport) => void;
	/** Parts of the default UI to leave out, to show your own — see lib/http/ui.ts. */
	ui?: Partial<HttpUi>;
	/**
	 * Same-origin requests the layer leaves alone entirely, as with
	 * `handles: "all"`: path prefixes, or a test. For libraries that ride out
	 * a lost connection their own way (a sync engine, an offline-first cache),
	 * which holding their requests would only get in the way of.
	 */
	exclude?: string[] | ((url: URL) => boolean);
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
	configureUi(options.ui ?? {});

	const rawFetch = globalThis.fetch.bind(globalThis);
	if (options.reportErrors ?? config.http.reportClientErrors) installErrorReporter(rawFetch);

	// Inner layer: maintenance. Requests that reach the code below have already
	// been held through any maintenance window.
	const uninstallMaintenance = installMaintenanceInterceptor({ ...options.maintenance, beforeRelease: runBeforeReconnect });
	const inner = globalThis.fetch;
	const uninstallConnectivity = installConnectivity(rawFetch);

	const { exclude } = options;
	const excluded = (url: URL) =>
		typeof exclude === "function" ? exclude(url) : !!exclude?.some((prefix) => url.pathname.startsWith(prefix));

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = resolve(input);
		const { handles = null, ...rest } = init ?? {};
		const sameOrigin = !!url && url.origin === (browser.location?.origin ?? url.origin);
		const api = sameOrigin && url.pathname.startsWith(API_PREFIX);

		// Not ours to hold, or the caller wants it left alone. Reading the version
		// an API response reports changes nothing for the caller.
		if (!url || !sameOrigin || handles === "all" || excluded(url)) {
			const response = await rawFetch(input, rest);
			if (api) noteServerVersion(response.headers.get(APP_VERSION_HEADER));
			return response;
		}
		/** The caller knows the layer: its error responses are ours to show. */
		const aware = api && handles !== null;

		const original = typeof input === "object" && !(input instanceof URL) ? input : null;
		const headers = new Headers(rest.headers ?? original?.headers);
		if (aware) headers.set(CLIENT_VERSION_HEADER, CLIENT_VERSION);
		const method = (rest.method ?? original?.method ?? "GET").toUpperCase();
		// The same key on every retry of this call, so the server can tell a
		// repeat from a new request (see lib/http/connectivity.ts).
		if (!READS.has(method) && !headers.has(IDEMPOTENCY_HEADER)) headers.set(IDEMPOTENCY_HEADER, crypto.randomUUID());
		const request: RequestInit = { ...rest, headers };

		/** Statuses the caller named, which it takes even when they mean "unreachable". */
		const named = (status: number) => Array.isArray(handles) && handles.includes(status);

		const send = async (signal?: AbortSignal): Promise<Outcome> => {
			try {
				// A Request's body can be read once: send a copy, keep the original for a retry.
				return { response: await inner(original ? original.clone() : input, signal ? { ...request, signal } : request) };
			} catch (error) {
				return { error };
			}
		};
		const aborted = (error: unknown) => rest.signal?.aborted || (error instanceof DOMException && error.name === "AbortError");
		const stillDown = (outcome: Outcome) =>
			"error" in outcome ? !aborted(outcome.error) : isUnreachable(outcome.response) && !named(outcome.response.status);

		let outcome: Outcome;
		if (named(0)) {
			// The caller takes network failures: no holding, no local answers.
			outcome = await send();
		} else {
			const result = await exchange({
				send,
				stillDown,
				request: () => (original ? original.clone() : new Request(url.href, request)),
				signal: rest.signal,
			});
			if (result.cancelled && aware) {
				const status = "response" in result.outcome ? result.outcome.response.status : 0;
				throw new HandledHttpError(t("connection.cancelled"), status);
			}
			outcome = result.outcome;
		}
		if ("error" in outcome) throw outcome.error;
		const response = outcome.response;

		const local = response.headers.has(OFFLINE_HEADER);
		if (api && !local) noteServerVersion(response.headers.get(APP_VERSION_HEADER));
		if (api && !local && response.status === 426) {
			const body = await readErrorBody(response);
			if (body?.code === CLIENT_OUTDATED_CODE) {
				// The update dialog says it all: no toast, no report.
				requireUpdate(response.headers.get(APP_VERSION_HEADER));
				if (aware && !named(426)) throw new HandledHttpError(body.error, 426, body);
			}
		}
		if (!aware || response.status < 400 || named(response.status)) return response;

		const fromApp = response.headers.has(APP_VERSION_HEADER) || local;
		const body = await readErrorBody(response);
		if (!local && (response.status >= 500 || !fromApp)) {
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
		options.onError?.({ message, level, description, status: response.status, body });
		if (getUi().errors) notify(message, level, description);
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
		uninstallConnectivity();
		uninstallMaintenance();
		removeEventListener("unhandledrejection", silenceHandled);
		stopChecking();
		configureUi(DEFAULT_UI);
		installed = false;
	};
}
