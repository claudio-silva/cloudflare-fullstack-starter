import { createAuthClient } from "better-auth/react";

function getBaseURL(): string {
	if (import.meta.env.DEV) {
		return "http://localhost:5173";
	}
	return window.location.origin;
}

export const authClient = createAuthClient({
	baseURL: getBaseURL(),
	fetchOptions: {
		// Opt Better Auth's own requests in to the HTTP layer with "responses":
		// its forms keep showing its errors, while a lost connection or a
		// maintenance window holds the request instead of failing it.
		customFetchImpl: (input, init) => fetch(input, { ...init, handles: "responses" }),
	},
});

export const { signIn, signUp, signOut, useSession, updateUser, changePassword, requestPasswordReset, resetPassword, sendVerificationEmail } = authClient;

// Social login helper
export const signInWithGoogle = () => authClient.signIn.social({ provider: "google" });
