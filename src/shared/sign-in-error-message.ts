/**
 * Turn a Better Auth sign-in failure into the message the user sees.
 *
 * Matching is on `code`, not on the English `message`: a substring test for
 * `"Invalid"` also catches `Invalid origin`, so a server that rejected the host
 * the page was served from would tell the user their password was wrong — the one
 * thing they cannot fix.
 *
 * Pure and framework-free, so it lives in `src/shared/` and is tested directly.
 */
export type SignInError = {
	code?: string | null;
	message?: string | null;
};

/** Rejections of *where the request came from*, which say nothing about credentials. */
const ORIGIN_REJECTION_CODES = new Set([
	"INVALID_ORIGIN",
	"MISSING_OR_NULL_ORIGIN",
	"INVALID_CALLBACK_URL",
	"INVALID_REDIRECT_URL",
	"CROSS_SITE_NAVIGATION_LOGIN_BLOCKED",
]);

const CREDENTIAL_CODES = new Set([
	"INVALID_EMAIL_OR_PASSWORD",
	"INVALID_PASSWORD",
	"INVALID_EMAIL",
	"USER_NOT_FOUND",
	"CREDENTIAL_ACCOUNT_NOT_FOUND",
]);

export function signInErrorMessage(error: SignInError, origin?: string): string {
	const code = error.code ?? "";

	if (ORIGIN_REJECTION_CODES.has(code)) {
		const where = origin ? ` (${origin})` : "";
		return `The server refused the request because of this page's address${where}. Your credentials were never checked — open the app at its configured address, or contact an administrator.`;
	}

	if (code === "EMAIL_NOT_VERIFIED") {
		return "Please verify your email before signing in.";
	}

	if (CREDENTIAL_CODES.has(code)) {
		return "Invalid email or password.";
	}

	/*
	 * No code (a network failure, a proxy's own error page) or one we don't map:
	 * show what the server said rather than guessing at credentials.
	 */
	const message = error.message?.trim();
	if (message && message.toLowerCase().includes("not verified")) {
		return "Please verify your email before signing in.";
	}
	return message && message.length > 0 ? message : "Failed to sign in.";
}
