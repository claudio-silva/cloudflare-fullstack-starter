import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { CLIENT_VERSION_HEADER, INTERNAL_ERROR_CODE, type AlertLevel, type ApiErrorBody } from "../../shared/http-contract";
import type { AppContext } from "../types/context";

/**
 * Every error response the Worker sends goes through here, so the browser can
 * rely on one shape (`ApiErrorBody`) and handle it in one place — see
 * src/react-app/lib/http/.
 *
 * The split that matters: `userMessage` is for the person using the app and is
 * shown to them; `log` is for the developer and is only logged. In production
 * the two never mix. Outside it, `log` travels as `debug` so a developer sees
 * the real cause in the browser console without opening the logs.
 *
 *   throw new AppError(403, "You can't edit someone else's post.", {
 *     log: `user ${user.id} tried to edit post ${post.id} owned by ${post.authorId}`,
 *     code: "post_not_owned",
 *   });
 */
export class AppError extends Error {
	readonly status: ContentfulStatusCode;
	readonly userMessage: string;
	readonly code?: string;
	readonly level?: AlertLevel;

	constructor(
		status: ContentfulStatusCode,
		userMessage: string,
		options: { log?: string; code?: string; level?: AlertLevel; cause?: unknown } = {},
	) {
		// The log message is the Error's message: it is what a stack trace or an
		// uncaught report shows, and that is the developer's view.
		super(options.log ?? userMessage, { cause: options.cause });
		this.name = "AppError";
		this.status = status;
		this.userMessage = userMessage;
		this.code = options.code;
		this.level = options.level;
	}
}

/**
 * The same response without throwing, for handlers that prefer `return`:
 *
 *   if (!post) return fail(c, 404, "That post no longer exists.", { log: `post ${id} not found` });
 */
export function fail(
	c: AppContext,
	status: ContentfulStatusCode,
	userMessage: string,
	options: { log?: string; code?: string; level?: AlertLevel } = {},
): Response {
	return errorResponse(c, new AppError(status, userMessage, options));
}

/**
 * `fail()` for routes under `/api/auth/`, whose responses are read by Better
 * Auth's client. It looks for `message` rather than `error`, so the same text
 * goes in both and its forms show ours instead of a generic failure.
 */
export async function failForAuthClient(
	c: AppContext,
	status: ContentfulStatusCode,
	userMessage: string,
	options: { log?: string; code?: string; level?: AlertLevel } = {},
	headers?: Record<string, string>,
): Promise<Response> {
	const body = (await fail(c, status, userMessage, options).json()) as ApiErrorBody;
	return c.json({ ...body, message: body.error }, status, headers);
}

const isProduction = (c: AppContext) => c.env?.ENVIRONMENT === "production";

/** The id to quote when reporting a problem: Cloudflare's ray id, or one of our own where there is none (local). */
export function requestIdOf(c: AppContext): string {
	return c.get("requestId") ?? c.req.header("cf-ray") ?? "unknown";
}

/** Structured, so Workers Logs can filter on any field. */
function logError(c: AppContext, status: number, error: unknown, extra: Record<string, unknown> = {}) {
	const entry = {
		msg: error instanceof Error ? error.message : String(error),
		status,
		method: c.req.method,
		path: c.req.path,
		requestId: requestIdOf(c),
		clientVersion: c.req.header(CLIENT_VERSION_HEADER),
		...extra,
		...(status >= 500 && error instanceof Error ? { stack: error.stack } : {}),
	};
	// 4xx are expected outcomes (a refused action, a missing record): warn, so
	// an alert on error-level logs only ever fires for real failures.
	if (status >= 500) console.error("[api]", entry);
	else console.warn("[api]", entry);
}

/**
 * Turn anything thrown in a handler into an `ApiErrorBody` response.
 *
 *  - `AppError`: its status, message and code, as the handler meant them.
 *  - Hono's `HTTPException` (thrown by validators and some middleware): its
 *    status and message, which are generic but not misleading.
 *  - Anything else is a bug: 500, a generic message, and the real error only
 *    in the logs — and, outside production, in `debug`.
 */
export function errorResponse(c: AppContext, error: unknown): Response {
	let status: ContentfulStatusCode = 500;
	let body: ApiErrorBody;

	if (error instanceof AppError) {
		status = error.status;
		body = { error: error.userMessage, ...(error.code ? { code: error.code } : {}), ...(error.level ? { level: error.level } : {}) };
	} else if (error instanceof HTTPException) {
		status = error.status as ContentfulStatusCode;
		// A response the exception already carries (set by whoever threw it) is theirs to keep.
		if (error.res) return error.res;
		body = { error: error.message || "The request could not be completed.", code: `http_${status}` };
	} else {
		body = { error: "Something went wrong on our side.", code: INTERNAL_ERROR_CODE };
	}

	body.requestId = requestIdOf(c);
	logError(c, status, error, error instanceof AppError && error.code ? { code: error.code } : {});

	if (!isProduction(c) && error instanceof Error) {
		body.debug = { message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
	}
	return c.json(body, status);
}
