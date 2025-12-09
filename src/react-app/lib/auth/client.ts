import { createAuthClient } from "better-auth/react";

function getBaseURL(): string {
	if (import.meta.env.DEV) {
		return "http://localhost:5173";
	}
	return window.location.origin;
}

export const authClient = createAuthClient({
	baseURL: getBaseURL(),
});

export const { signIn, signUp, signOut, useSession, updateUser, changePassword } = authClient;
