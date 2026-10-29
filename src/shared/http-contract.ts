/**
 * The contract between the Worker and the browser for everything that is not
 * a feature: versions, errors and user-facing alerts.
 *
 * Both sides import this file, so a header renamed on one side cannot quietly
 * stop matching the other.
 */

/** On every Worker response: the version of the code that answered. */
export const APP_VERSION_HEADER = "X-App-Version";

/** On every API request from the app: the version of the code that asked. */
export const CLIENT_VERSION_HEADER = "X-Client-Version";

/**
 * The `code` of the 426 the Worker sends to a tab built for an incompatible
 * version (`isBreakingChange`): the tab must reload before it may continue.
 */
export const CLIENT_INCOMPATIBLE_CODE = "client_incompatible";

/**
 * The part of a release version that changes only with an incompatible
 * release, by semver: the major, or for `0.x`, where everything may change,
 * the minor too. `null` when the version cannot be read.
 *
 *   2.4.1 → "2"     0.3.7 → "0.3"     1.0.0-rc.2+preview.ab12 → "1"
 */
export function compatibilityLine(version: string): string | null {
	const match = /^v?(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(version.trim());
	if (!match) return null;
	const [, major, minor] = match;
	return Number(major) === 0 ? `0.${Number(minor)}` : String(Number(major));
}

/**
 * Whether code built as `a` and code built as `b` cannot be trusted to work
 * together — a major apart, in either direction, since a rollback breaks as
 * surely as a release. A version that cannot be read never counts as one.
 */
export function isBreakingChange(a: string, b: string): boolean {
	const x = compatibilityLine(a);
	const y = compatibilityLine(b);
	return x !== null && y !== null && x !== y;
}

/** On maintenance responses, to tell them from any other 503. */
export const MAINTENANCE_HEADER = "X-Maintenance";

export type AlertLevel = "info" | "warning" | "error";

/**
 * The body of every error response the Worker produces (status >= 400).
 *
 * `error` is written for the person using the app and is shown to them as it
 * is. What the developer needs — the real cause — is logged on the server and
 * never travels in production. Outside production it is attached as `debug`,
 * so a developer sees it in the browser without opening the logs.
 */
export type ApiErrorBody = {
	/** Shown to the user. Plain text, one or two sentences. */
	error: string;
	/**
	 * Stable, machine-readable. Lets a caller react to one specific case, and
	 * lets the client replace `error` with a translation keyed `error.<code>`.
	 */
	code?: string;
	/** How the client presents it. Defaults to `warning` for 4xx, `error` for 5xx. */
	level?: AlertLevel;
	/** Quote this to find the request in the logs. The Cloudflare ray id when there is one. */
	requestId?: string;
	/** Never present in production. */
	debug?: { message?: string; stack?: string };
};

/** The code of errors nobody anticipated: the client shows its generic message for these. */
export const INTERNAL_ERROR_CODE = "internal";

/** Where the browser reports its own errors. */
export const CLIENT_ERRORS_PATH = "/api/client-errors";

export type ClientErrorKind = "error" | "unhandledrejection" | "http" | "chunk";

/** One report. Every string is capped on both sides: this endpoint is open to anyone. */
export type ClientErrorReport = {
	kind: ClientErrorKind;
	message: string;
	stack?: string;
	/** The page the user was on. */
	page: string;
	/** For `http`: the failing request. */
	request?: { method: string; url: string; status: number; requestId?: string };
	/** Milliseconds since the epoch, as the browser saw it. */
	at: number;
};

export const CLIENT_ERROR_LIMITS = {
	reportsPerBatch: 10,
	message: 1_000,
	stack: 8_000,
	url: 2_000,
	/** The whole request body. Anything larger is refused before it is parsed. */
	bodyBytes: 32 * 1024,
} as const;
