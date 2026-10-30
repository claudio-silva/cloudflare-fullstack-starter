import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

// Better Auth does not know the HTTP layer, and needs not: its forms show its
// own errors, while a lost connection or a maintenance window holds its
// requests like anyone else's (lib/http/interceptor.ts).
// The API is served by the same origin as the page, in dev on any port too.
export const authClient = createAuthClient({
	baseURL: window.location.origin,
	// Mirrors `user.additionalFields` in src/worker/middleware/auth.ts, so
	// `session.user.role` is typed. See src/shared/roles.ts.
	plugins: [inferAdditionalFields({ user: { role: { type: "string", input: false, required: false } } })],
});

export const { signIn, signUp, signOut, useSession, updateUser, changePassword, requestPasswordReset, resetPassword, sendVerificationEmail } = authClient;

// Social login helper
export const signInWithGoogle = () => authClient.signIn.social({ provider: "google" });
