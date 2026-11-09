import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthFetch, getSessionEnded } from "./session-ended";
import { setProvidersLoader } from "./reauth-methods";

// Better Auth captures `fetch` when the client is created, which is before
// main.tsx installs the HTTP layer, so without `customFetchImpl` its requests
// would keep the raw fetch and bypass the whole chain (connectivity,
// maintenance, the session-ended guard). `createAuthFetch` looks `fetch` up per
// request instead, so they pass through it like everyone else's. It also tells
// the session-ended state who is signed in (lib/auth/session-ended.ts).
// The API is served by the same origin as the page, in dev on any port too.
export const authClient = createAuthClient({
	baseURL: window.location.origin,
	fetchOptions: { customFetchImpl: createAuthFetch(getSessionEnded()) },
	// Mirrors `user.additionalFields` in src/worker/middleware/auth.ts, so
	// `session.user.role` and `.disabled` are typed. See src/shared/roles.ts.
	plugins: [inferAdditionalFields({ user: { role: { type: "string", input: false, required: false }, disabled: { type: "boolean", input: false, required: false } } })],
});

// How the signed-in account signs in, for the re-login dialog (lib/auth/reauth-methods.ts). A failure is "unknown", never a throw.
setProvidersLoader(async () => {
	const { data, error } = await authClient.listAccounts();
	return error || !data ? null : data.map((account) => account.providerId);
});

export const { signIn, signUp, signOut, useSession, updateUser, changePassword, requestPasswordReset, resetPassword, sendVerificationEmail } = authClient;

// Social login helper
export const signInWithGoogle = () => authClient.signIn.social({ provider: "google" });
