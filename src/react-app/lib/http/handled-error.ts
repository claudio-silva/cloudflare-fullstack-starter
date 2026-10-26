import type { ApiErrorBody } from "../../../shared/http-contract";

/**
 * What an API call throws once the HTTP layer has already dealt with a
 * failure: the user has been told, or chose to cancel.
 *
 * This is what makes the handling global, as an Angular interceptor's is: the
 * caller's code after `await fetch(...)` simply does not run, so call sites
 * need no `if (!res.ok)` for the cases handled here. They only `catch` when
 * they have something of their own to undo — and then let this one go:
 *
 *   try {
 *     await fetch("/api/posts", { method: "POST", body });
 *     navigate("/posts");
 *   } finally {
 *     setSaving(false);
 *   }
 *
 * Unhandled, it is silenced (see installHttpLayer): it is an expected outcome,
 * not a crash, and it must not reach the error reporter.
 */
export class HandledHttpError extends Error {
	readonly handled = true;

	constructor(
		message: string,
		/** 0 for a network failure. */
		readonly status: number,
		readonly body?: ApiErrorBody,
		options?: { cause?: unknown },
	) {
		super(message);
		this.name = "HandledHttpError";
		// Assigned rather than passed to super(): the app's `lib` predates the `cause` option.
		if (options && "cause" in options) Object.defineProperty(this, "cause", { value: options.cause });
	}
}

export function isHandledHttpError(error: unknown): error is HandledHttpError {
	return error instanceof HandledHttpError;
}
