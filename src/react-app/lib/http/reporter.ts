import {
	CLIENT_ERRORS_PATH,
	CLIENT_ERROR_LIMITS as L,
	CLIENT_VERSION_HEADER,
	type ClientErrorReport,
} from "../../../shared/http-contract";
import { CLIENT_VERSION } from "./version";
import { browser } from "./browser";
import { isHandledHttpError } from "./handled-error";

/**
 * Sends the browser's own errors to the Worker logs (POST /api/client-errors),
 * so developers learn about them without waiting for a user to complain.
 *
 * Kept deliberately cheap and quiet:
 *
 *  - each distinct error is sent once per page load, and at most
 *    `maxPerPage` reports in total — a render loop throwing forever costs one
 *    report, not thousands;
 *  - reports are batched and sent every few seconds, and on page hide with
 *    `sendBeacon`, which survives the page closing;
 *  - it uses the unpatched `fetch`, so its own failures never surface as
 *    dialogs or toasts, and are simply dropped.
 *
 * What it reports: uncaught errors, unhandled promise rejections (except
 * `HandledHttpError`, which is an expected outcome), stale chunk loads, and —
 * from the interceptor — 5xx responses and error responses that did not come
 * from the app at all (the edge, a proxy, a firewall), which the Worker never
 * saw and so never logged.
 */

let queue: ClientErrorReport[] = [];
const seen = new Set<string>();
let sent = 0;
let send: ((body: string) => void) | null = null;
let maxPerPage = 25;

const cut = (s: string | undefined, max: number) => (s && s.length > max ? s.slice(0, max) : s);

export function reportClientError(report: Omit<ClientErrorReport, "at" | "page">): void {
	if (!send) return;
	const signature = `${report.kind}|${report.message}|${report.request?.url ?? ""}|${report.request?.status ?? ""}`;
	if (seen.has(signature) || sent + queue.length >= maxPerPage) return;
	seen.add(signature);
	queue.push({
		...report,
		message: cut(report.message, L.message) ?? "",
		stack: cut(report.stack, L.stack),
		page: cut(browser.location?.href ?? "", L.url) ?? "",
		at: Date.now(),
	});
}

function flush(useBeacon = false): void {
	if (!send || queue.length === 0) return;
	const batch = queue.slice(0, L.reportsPerBatch);
	queue = queue.slice(L.reportsPerBatch);
	sent += batch.length;
	const body = JSON.stringify({ reports: batch });
	if (useBeacon && browser.navigator?.sendBeacon) {
		browser.navigator.sendBeacon(CLIENT_ERRORS_PATH, new Blob([body], { type: "application/json" }));
	} else {
		send(body);
	}
}

const describe = (value: unknown): { message: string; stack?: string } =>
	value instanceof Error ? { message: `${value.name}: ${value.message}`, stack: value.stack } : { message: String(value) };

export function installErrorReporter(rawFetch: typeof fetch, opts: { maxPerPage?: number; flushEveryMs?: number } = {}): void {
	if (send || !browser.addEventListener) return;
	maxPerPage = opts.maxPerPage ?? maxPerPage;
	send = (body) => {
		void rawFetch(CLIENT_ERRORS_PATH, {
			method: "POST",
			headers: { "Content-Type": "application/json", [CLIENT_VERSION_HEADER]: CLIENT_VERSION },
			body,
			// Lets a report sent as the page goes away still arrive. Cast: the
			// Workers typings, under which the tests compile this, lack it.
			keepalive: true,
		} as RequestInit).catch(() => undefined);
	};

	browser.addEventListener("error", (event) => {
		const e = event as ErrorEvent;
		reportClientError({ kind: "error", ...describe(e.error ?? e.message) });
	});
	browser.addEventListener("unhandledrejection", (event) => {
		const reason = (event as PromiseRejectionEvent).reason;
		if (isHandledHttpError(reason)) return;
		reportClientError({ kind: "unhandledrejection", ...describe(reason) });
	});
	setInterval(() => flush(), opts.flushEveryMs ?? 5_000);
	browser.addEventListener("pagehide", () => flush(true));
}

/** For tests: what is waiting to be sent, and a fresh start. */
export function pendingReports(): ClientErrorReport[] {
	return [...queue];
}
export function resetReporter(sender: ((body: string) => void) | null = null): void {
	queue = [];
	seen.clear();
	sent = 0;
	send = sender;
}
export { flush as flushReports };
