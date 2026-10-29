import { betterAuth } from "better-auth";
import bcrypt from "bcryptjs";
import { recordSessionEnds } from "../lib/login-log";
import { createDb, databaseKind } from "../db";
import type { AppContext, AppUser } from "../types/context";
import { createEmailSender, type EmailSender } from "../adapters/email";
import { getVerificationEmailTemplate, getPasswordResetEmailTemplate } from "../utils/email-templates";
import { config } from "../../config";
import { fail, failForAuthClient } from "../lib/errors";

type Environment = "local" | "preview" | "production" | "test";

function getBaseURL(c: AppContext, environment: Environment): string {
	if (c.env.APP_BASE_URL) return c.env.APP_BASE_URL;

	return environment === "preview" || environment === "production"
		? config.baseUrls[environment]
		: config.baseUrls.local;
}

function isEnabled(value?: string): boolean {
	return value === "true" || value === "1";
}

function shouldUseAuthEmails(environment: Environment, env: { AUTH_EMAILS_LOCAL_ENABLED?: string }): boolean {
	return environment !== "local" || isEnabled(env.AUTH_EMAILS_LOCAL_ENABLED);
}

function getAuthEmailSender(c: AppContext, environment: Environment, authEmailsEnabled: boolean): EmailSender | null {
	if (!authEmailsEnabled) {
		return null;
	}

	try {
		return createEmailSender(c.env);
	} catch (error) {
		if (environment === "local") {
			console.warn("[EMAIL] Auth email provider is not configured; skipping local auth emails.", error instanceof Error ? error.message : error);
			return null;
		}

		throw error;
	}
}

// The local-environment summary is printed once per isolate, not on every request.
let environmentLogged = false;

/**
 * Sends an auth email without making the response wait for it. Better Auth
 * awaits these callbacks only for addresses that have an account, so an awaited
 * send makes those requests slower (and a provider failure visible), which
 * tells a caller which addresses exist. A failure is logged without the address.
 */
function sendInBackground(c: AppContext, delivery: Promise<unknown>, what: string) {
	const handled = delivery.catch((error: unknown) => {
		console.error(`[EMAIL] ${what} email failed:`, error instanceof Error ? error.message : "unknown error");
	});
	try {
		c.executionCtx.waitUntil(handled);
	} catch {
		// No ExecutionContext (tests, Node): the promise already has its catch, so fire and forget.
	}
}

export function createAuth(c: AppContext) {
	const environment: Environment = (c.env.ENVIRONMENT as Environment) || "local";
	const db = createDb(c.env);

	const authEmailsEnabled = shouldUseAuthEmails(environment, {
		AUTH_EMAILS_LOCAL_ENABLED: c.env.AUTH_EMAILS_LOCAL_ENABLED,
	});
	const emailSender = getAuthEmailSender(c, environment, authEmailsEnabled);

	// Log email configuration once per isolate (helpful for debugging)
	if (environment === "local" && !environmentLogged) {
		environmentLogged = true;
		console.log(
			`[AUTH] Environment: ${environment}, Auth emails: ${authEmailsEnabled ? "enabled" : "disabled"}, `
			+ `Email sender: ${emailSender ? `configured` : "not configured"}`,
		);
	}

	const secret = c.env.BETTER_AUTH_SECRET;
	if (!secret && environment !== "local" && environment !== "test") {
		throw new Error("BETTER_AUTH_SECRET is not configured. Set it in .env.<env> and redeploy.");
	}

	const shouldRequireEmailVerification = authEmailsEnabled && !!emailSender;

	// Configure Google OAuth if credentials are provided and enabled in config
	const googleOAuthEnabled = config.auth.enableGoogleAuth && c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET;

	return betterAuth({
		// In local/test, Better Auth falls back to its built-in dev secret.
		secret,
		database: {
			db,
			type: databaseKind,
		},
		user: {
			modelName: "users",
			// Exposed on the session (and to the browser) so the UI can show what
			// the role allows; `input: false` keeps sign-up and updateUser from
			// setting it. Read from the database on every session check, so a
			// role change applies to the next request.
			additionalFields: {
				role: { type: "string", input: false, required: false, defaultValue: "user" },
			},
		},
		session: {
			modelName: "sessions",
			// Sessions expire after 24 hours without use: every touch (see updateAge)
			// pushes the expiry a day ahead, so an active user stays signed in.
			expiresIn: 60 * 60 * 24,
			// A session is touched at most this often, and that touch is the user's
			// "last seen" (the admin area shows Active / Idle from it). A day would
			// leave it a day stale; a minute costs one small write per active session.
			updateAge: 60,
		},
		// Better Auth deletes an expired session when it is looked up again, which
		// the cron cannot see afterwards: record it here (see lib/login-log.ts).
		databaseHooks: {
			session: {
				delete: {
					before: async (session) => {
						if (new Date(session.expiresAt).getTime() < Date.now()) {
							await recordSessionEnds(db, [{ userId: session.userId, ipAddress: session.ipAddress ?? null, userAgent: session.userAgent ?? null, expiresAt: session.expiresAt }], "session-expired");
						}
					},
				},
			},
		},
		account: { modelName: "accounts" },
		verification: { modelName: "verifications" },
		socialProviders: googleOAuthEnabled ? {
			google: {
				clientId: c.env.GOOGLE_CLIENT_ID!,
				clientSecret: c.env.GOOGLE_CLIENT_SECRET!,
			},
		} : undefined,
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: shouldRequireEmailVerification,
			password: {
				hash: async (password) => bcrypt.hash(password, 10),
				verify: async ({ hash, password }) => bcrypt.compare(password, hash),
			},
			sendResetPassword: async ({ user, url }) => {
				if (!emailSender) {
					console.warn("[EMAIL] Auth emails are disabled or email provider is not configured; skipping password reset email.");
					return;
				}
				// Modify URL to use frontend route instead of API route and include email for auto sign-in
				const modifiedUrl = url.replace("/api/auth/reset-password", "/reset-password")
					+ `&email=${encodeURIComponent(user.email)}`;
				const html = getPasswordResetEmailTemplate(user.name || user.email, modifiedUrl);
				sendInBackground(c, emailSender.sendEmail({ to: user.email, subject: "Reset your password", html }), "Password reset");
			},
		},
		emailVerification: {
			sendOnSignUp: shouldRequireEmailVerification,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				if (!emailSender) {
					console.warn("[EMAIL] Auth emails are disabled or email provider is not configured; skipping verification email.");
					return;
				}
				const modifiedUrl = url.replace("/api/auth/verify-email", "/verify-email");
				const html = getVerificationEmailTemplate(user.name || user.email, modifiedUrl);
				sendInBackground(c, emailSender.sendEmail({ to: user.email, subject: "Verify your account", html }), "Verification");
			},
		},
		telemetry: {
			enabled: false,
		},
		baseURL: getBaseURL(c, environment),
	});
}

export async function authMiddleware(c: AppContext, next: () => Promise<void>) {
	const environment: Environment = (c.env.ENVIRONMENT as Environment) || "local";

	if (environment === "test") {
		c.set("user", { id: "test-user", email: "test@example.com", name: "Test User", role: "user" } as AppUser);
		return next();
	}

	const auth = createAuth(c);
	const session = await auth.api.getSession({ headers: c.req.raw.headers });

	if (!session) {
		return fail(c, 401, "Your session has expired. Please sign in again.", {
			code: "unauthenticated",
			log: "no valid session",
		});
	}

	c.set("user", session.user);
	c.set("session", session.session);
	return next();
}

// Better Auth answers its own errors (wrong password and the like) in its own
// format, for its client. Anything it throws is a bug or a misconfiguration,
// and goes to app.onError like any other: logged, and a generic 500.
export async function handleAuthRequest(c: AppContext) {
	const isSignUpPath = c.req.path.includes("/sign-up");
	if (!config.auth.enableSignups && isSignUpPath) {
		return failForAuthClient(c, 403, "Sign-up is disabled.", { code: "signups_disabled" });
	}

	const auth = createAuth(c);
	return auth.handler(c.req.raw);
}
