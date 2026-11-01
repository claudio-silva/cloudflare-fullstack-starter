/**
 * The decisions and the checks of `npm run setup:google`, kept apart from the
 * prompting so they can be tested: what Google has to be told, and how to find
 * out — without a browser — whether it was told correctly.
 *
 * Creating the OAuth client itself cannot be automated: Google has no public
 * API for a "Web application" client, and the one API that came close (the IAP
 * OAuth Admin API) is being shut down. What a command *can* do is work out
 * every value to paste, and then verify the result, which is where the time
 * actually goes. See docs/GOOGLE_AUTH.md.
 */

/** Better Auth serves the social callback under its own base path. */
export const CALLBACK_PATH = "/api/auth/callback/google";

export const CONSOLE_CLIENTS_URL = "https://console.cloud.google.com/auth/clients";
export const CONSOLE_BRANDING_URL = "https://console.cloud.google.com/auth/branding";

/** `https://app.acme.io/` → `https://app.acme.io` (what Google calls an origin). */
export function origin(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "");
}

/** The redirect URI to register for an app served at `baseUrl`. */
export function redirectUri(baseUrl: string): string {
	return `${origin(baseUrl)}${CALLBACK_PATH}`;
}

/**
 * The authorization URL used as a probe. Nothing is signed in and no secret is
 * sent: Google answers for the client and the redirect URI alone, which is
 * exactly the pair that is usually wrong.
 */
export function authorizeProbeUrl(clientId: string, uri: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: uri,
		response_type: "code",
		scope: "openid email profile",
		// Nothing is ever redirected to: the answer is read from Google's own page.
		prompt: "none",
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export type ProbeVerdict = "ok" | "unknown-client" | "redirect-mismatch" | "unclear";

/**
 * The error Google puts in the `authError` parameter when it refuses an
 * authorization request. It is base64url of a small binary payload, but the
 * error's name is plain text inside it (`redirect_uri_mismatch`,
 * `invalid_client`, …), which is all this reads.
 */
export function decodeAuthError(location: string | null | undefined): string {
	if (!location) return "";
	try {
		const value = new URL(location, "https://accounts.google.com").searchParams.get("authError");
		return value ? Buffer.from(value, "base64url").toString("latin1") : "";
	} catch {
		return "";
	}
}

/**
 * What Google's authorization endpoint says about a client and a redirect URI.
 *
 * It answers 302 — either back to the redirect URI, or to its own error page
 * with the reason in `authError` — so the verdict comes from the Location
 * header rather than from a status code.
 *
 * Google checks in order: the client, then the redirect URI, then everything
 * else. So **any** outcome other than those two errors means both were
 * accepted: a probe that trips over the scopes, or lands on a sign-in page,
 * has already proved what it was asked to prove.
 */
export function readAuthorizeAnswer(status: number, location: string | null | undefined, body = ""): ProbeVerdict {
	const text = `${decodeAuthError(location)} ${body}`;
	if (/redirect_uri_mismatch/i.test(text)) return "redirect-mismatch";
	if (/invalid_client|deleted_client|OAuth client was not found/i.test(text)) return "unknown-client";
	if (status >= 500) return "unclear";
	return "ok";
}

export type SecretVerdict = "ok" | "wrong-secret" | "unknown-client" | "unclear";

/**
 * What the token endpoint says about a client id and secret.
 *
 * Asked with a deliberately invalid authorization code: a client Google
 * accepts then fails on the *code* (`invalid_grant`), and one it does not
 * fails on the *client* (`invalid_client`). So the answer separates a wrong
 * secret from a wrong id without anyone signing in.
 */
export function readTokenAnswer(status: number, body: { error?: string; error_description?: string } | null): SecretVerdict {
	const error = body?.error ?? "";
	if (error === "invalid_grant") return "ok";
	if (error === "invalid_client") return /not found|deleted/i.test(body?.error_description ?? "") ? "unknown-client" : "wrong-secret";
	if (status === 200) return "unclear";
	return "unclear";
}

export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The body of the token probe: a code that cannot be valid, so nothing is ever granted. */
export function tokenProbeBody(clientId: string, clientSecret: string, uri: string): URLSearchParams {
	return new URLSearchParams({
		code: "setup-google-probe",
		client_id: clientId,
		client_secret: clientSecret,
		redirect_uri: uri,
		grant_type: "authorization_code",
	});
}

/**
 * A client id looks like `1234-abc.apps.googleusercontent.com`; say so early
 * rather than probing nonsense. The `-abc` part is missing on older clients
 * (Google's own gcloud client is `32555940559.apps.googleusercontent.com`).
 */
export function looksLikeClientId(value: string): boolean {
	return /^[0-9]+(-[a-z0-9-]+)?\.apps\.googleusercontent\.com$/i.test(value.trim());
}

export function looksLikeClientSecret(value: string): boolean {
	return /^GOCSPX-[\w-]{10,}$/.test(value.trim()) || value.trim().length >= 20;
}
