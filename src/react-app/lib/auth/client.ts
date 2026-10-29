import { createAuthClient } from "better-auth/react";

function getBaseURL(): string {
	if (import.meta.env.DEV) {
		return "http://localhost:5173";
	}
	return window.location.origin;
}

// Better Auth does not know the HTTP layer, and needs not: its forms show its
// own errors, while a lost connection or a maintenance window holds its
// requests like anyone else's (lib/http/interceptor.ts).
export const authClient = createAuthClient({
	baseURL: getBaseURL(),
});

export const { signIn, signUp, signOut, useSession, updateUser, changePassword, requestPasswordReset, resetPassword, sendVerificationEmail } = authClient;

// Social login helper
export const signInWithGoogle = () => authClient.signIn.social({ provider: "google" });
