import type { ApiErrorBody } from "./http-contract";

/**
 * Wire contract for "this account was disabled". Every path that acts for a
 * signed-in user (and the sign-in itself) answers HTTP 403 with this body. 403
 * is "known, but refused"; the machine `code` tells refusals apart. 401 keeps
 * meaning "no session, or an expired one".
 */
export const ACCOUNT_DISABLED_CODE = "account_disabled" as const;
export const ACCOUNT_DISABLED_STATUS = 403 as const;
export const ACCOUNT_DISABLED_MESSAGE = "This account has been disabled. Contact an administrator.";

/** The body every disabled-account refusal carries. */
export function accountDisabledBody(): ApiErrorBody {
	return { error: ACCOUNT_DISABLED_MESSAGE, code: ACCOUNT_DISABLED_CODE, level: "info" };
}

/** True for `{ code: "account_disabled", error: string }`; false for anything else, including null. */
export function isAccountDisabledBody(body: unknown): boolean {
	if (typeof body !== "object" || body === null) return false;
	const b = body as Record<string, unknown>;
	return b.code === ACCOUNT_DISABLED_CODE && typeof b.error === "string";
}
