import { describe, expect, it } from "vitest";
import {
	CALLBACK_PATH,
	authorizeProbeUrl,
	decodeAuthError,
	looksLikeClientId,
	looksLikeClientSecret,
	origin,
	readAuthorizeAnswer,
	readTokenAnswer,
	redirectUri,
	tokenProbeBody,
} from "../../bin/lib/google-oauth";

// The answers below were captured from Google itself, so the parser is tested
// against what it will actually meet rather than against what it expects.
const ERROR_PAGE = "https://accounts.google.com/signin/oauth/error?authError=";
const UNKNOWN_CLIENT = `${ERROR_PAGE}Cg5pbnZhbGlkX2NsaWVudBIfVGhlIE9BdXRoIGNsaWVudCB3YXMgbm90IGZvdW5kLiCRAw&flowName=GeneralOAuthFlow`;
const MISMATCH = `${ERROR_PAGE}ChVyZWRpcmVjdF91cmlfbWlzbWF0Y2ggkAMyAggB&flowName=GeneralOAuthFlow`;
const SCOPE_REFUSED = `${ERROR_PAGE}ChFyZXN0cmljdGVkX2NsaWVudBItVW5yZWdpc3RlcmVkIHNjb3BlKHMpIGluIHRoZSByZXF1ZXN0OiBwcm9maWxlIJMD`;

describe("what Google has to be told", () => {
	it("derives the redirect URI from the app's base URL", () => {
		expect(redirectUri("https://app.acme.io/")).toBe(`https://app.acme.io${CALLBACK_PATH}`);
		expect(redirectUri("http://localhost:5173")).toBe(`http://localhost:5173${CALLBACK_PATH}`);
		expect(origin("https://app.acme.io/")).toBe("https://app.acme.io");
	});

	it("probes without a secret, without UI and without signing anyone in", () => {
		const url = new URL(authorizeProbeUrl("123-abc.apps.googleusercontent.com", "https://app.acme.io/cb"));
		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(url.searchParams.get("redirect_uri")).toBe("https://app.acme.io/cb");
		expect(url.searchParams.get("prompt")).toBe("none");
		expect(url.searchParams.get("scope")).toBe("openid email profile");
		expect(url.search).not.toMatch(/secret/);
	});

	it("recognises a client id and a client secret before asking Google about them", () => {
		expect(looksLikeClientId("1066123456789-a1b2c3.apps.googleusercontent.com")).toBe(true);
		// Older clients have no random part; Google's own gcloud client is one.
		expect(looksLikeClientId("32555940559.apps.googleusercontent.com")).toBe(true);
		expect(looksLikeClientId("not-a-client")).toBe(false);
		expect(looksLikeClientSecret("GOCSPX-abcdefghij1234567890")).toBe(true);
		expect(looksLikeClientSecret("short")).toBe(false);
	});
});

describe("Google's answer to the authorization probe", () => {
	it("reads the error out of the authError parameter", () => {
		expect(decodeAuthError(MISMATCH)).toContain("redirect_uri_mismatch");
		expect(decodeAuthError(UNKNOWN_CLIENT)).toContain("The OAuth client was not found.");
		expect(decodeAuthError(null)).toBe("");
		expect(decodeAuthError("https://accounts.google.com/x?authError=%%%")).toBe("");
	});

	it("tells an unregistered redirect URI from an unknown client", () => {
		expect(readAuthorizeAnswer(302, MISMATCH)).toBe("redirect-mismatch");
		expect(readAuthorizeAnswer(302, UNKNOWN_CLIENT)).toBe("unknown-client");
	});

	it("counts anything past those two checks as proof that both passed", () => {
		// Google checks the client, then the redirect URI, then the rest: this
		// one got as far as the scopes, so the URI is registered.
		expect(readAuthorizeAnswer(302, SCOPE_REFUSED)).toBe("ok");
		// prompt=none with nobody signed in: straight back to the app.
		expect(readAuthorizeAnswer(302, "https://app.acme.io/api/auth/callback/google?error=login_required")).toBe("ok");
		expect(readAuthorizeAnswer(200, null, "<html>sign in</html>")).toBe("ok");
	});

	it("does not claim to know when Google is the one that is broken", () => {
		expect(readAuthorizeAnswer(503, null, "")).toBe("unclear");
	});
});

describe("Google's answer to the token probe", () => {
	it("tells a wrong secret from an unknown client", () => {
		expect(readTokenAnswer(401, { error: "invalid_client", error_description: "The provided client secret is invalid." })).toBe("wrong-secret");
		expect(readTokenAnswer(401, { error: "invalid_client", error_description: "The OAuth client was not found." })).toBe("unknown-client");
	});

	it("reads a complaint about the code as proof that the pair is right", () => {
		// The code is deliberately invalid; reaching it means the credentials were accepted.
		expect(readTokenAnswer(400, { error: "invalid_grant", error_description: "Malformed auth code." })).toBe("ok");
	});

	it("never sends a real code", () => {
		const body = tokenProbeBody("id", "secret", "https://app.acme.io/cb");
		expect(body.get("code")).toBe("setup-google-probe");
		expect(body.get("grant_type")).toBe("authorization_code");
	});

	it("admits it cannot tell", () => {
		expect(readTokenAnswer(200, null)).toBe("unclear");
		expect(readTokenAnswer(500, { error: "backend_error" })).toBe("unclear");
	});
});
