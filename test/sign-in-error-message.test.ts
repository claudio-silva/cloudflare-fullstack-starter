import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "../src/shared/sign-in-error-message";

describe("sign-in error messages", () => {
	it("blames the credentials only when the credentials were refused", () => {
		expect(
			signInErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }),
		).toBe("Invalid email or password.");
	});

	it("names the address when the origin was refused, and never blames the password", () => {
		const message = signInErrorMessage(
			{ code: "INVALID_ORIGIN", message: "Invalid origin" },
			"http://dev--abc.localhost:6767",
		);
		expect(message).toContain("http://dev--abc.localhost:6767");
		expect(message).toContain("address");
		expect(message).not.toContain("Invalid email or password");
	});

	it("treats the whole origin-rejection family the same way", () => {
		for (const code of [
			"MISSING_OR_NULL_ORIGIN",
			"INVALID_CALLBACK_URL",
			"INVALID_REDIRECT_URL",
			"CROSS_SITE_NAVIGATION_LOGIN_BLOCKED",
		]) {
			const message = signInErrorMessage({ code, message: "Invalid something" });
			expect(message, code).toContain("address");
			expect(message, code).not.toContain("Invalid email or password");
		}
	});

	it("keeps the unverified-email message, by code or by text", () => {
		expect(signInErrorMessage({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" })).toBe(
			"Please verify your email before signing in.",
		);
		expect(signInErrorMessage({ code: null, message: "Email is not verified" })).toBe(
			"Please verify your email before signing in.",
		);
	});

	it("shows what the server said for anything it does not map", () => {
		expect(
			signInErrorMessage({ code: "FAILED_TO_CREATE_SESSION", message: "Failed to create session" }),
		).toBe("Failed to create session");
		expect(signInErrorMessage({})).toBe("Failed to sign in.");
	});
});
