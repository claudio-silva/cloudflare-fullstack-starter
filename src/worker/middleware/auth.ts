import { betterAuth } from "better-auth";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import bcrypt from "bcryptjs";
import type { Database } from "../types/database";
import type { AppContext, AppUser } from "../types/context";
import { createResendEmailSender } from "../utils/resend";
import { getVerificationEmailTemplate, getPasswordResetEmailTemplate } from "../utils/email-templates";
import { config } from "../../config";

type Environment = "local" | "preview" | "production" | "test";

function getBaseURL(environment: Environment): string {
	switch (environment) {
		case "local":
			return "http://localhost:5173";
		case "preview":
			return "https://preview.example.com";
		case "production":
			return "https://app.example.com";
		default:
			return "http://localhost:5173";
	}
}

export function createAuth(c: AppContext) {
	const environment: Environment = (c.env.ENVIRONMENT as Environment) || "local";
	const d1Db = c.env.DB;

	if (!d1Db) {
		throw new Error("Database binding (DB) is not available");
	}

	const db = new Kysely<Database>({
		dialect: new D1Dialect({ database: d1Db }),
	});

	const emailSender = c.env.RESEND_API_KEY ? createResendEmailSender(c.env) : null;

	// Log email configuration on first auth call (helpful for debugging)
	if (environment === "local") {
		console.log(`[AUTH] Environment: ${environment}, Email sender: ${emailSender ? "configured" : "not configured (RESEND_API_KEY not set)"}`);
	}

	// Email verification is required if:
	// - We're in production/preview environment, OR
	// - We have a RESEND_API_KEY configured (allows testing email in local)
	const shouldRequireEmailVerification = environment !== "local" || !!emailSender;

	// Configure Google OAuth if credentials are provided and enabled in config
	const googleOAuthEnabled = config.auth.enableGoogleAuth && c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET;

	return betterAuth({
		database: {
			db,
			type: "sqlite",
		},
		user: { modelName: "users" },
		session: {
			modelName: "sessions",
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24,
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
					console.warn("[EMAIL] RESEND_API_KEY not set; skipping password reset email (local/dev).");
					return;
				}
				// Modify URL to use frontend route instead of API route and include email for auto sign-in
				const modifiedUrl = url.replace("/api/auth/reset-password", "/reset-password")
					+ `&email=${encodeURIComponent(user.email)}`;
				const html = getPasswordResetEmailTemplate(user.name || user.email, modifiedUrl);
				await emailSender.sendVerificationEmail({
					to: user.email,
					subject: "Reset your password",
					html,
				});
			},
		},
		emailVerification: {
			sendOnSignUp: shouldRequireEmailVerification,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				if (!emailSender) {
					console.warn("[EMAIL] RESEND_API_KEY not set; skipping verification email (local/dev).");
					return;
				}
				const modifiedUrl = url.replace("/api/auth/verify-email", "/verify-email");
				const html = getVerificationEmailTemplate(user.name || user.email, modifiedUrl);
				await emailSender.sendVerificationEmail({
					to: user.email,
					subject: "Verify your account",
					html,
				});
			},
		},
		baseURL: getBaseURL(environment),
	});
}

export async function authMiddleware(c: AppContext, next: () => Promise<void>) {
	const environment: Environment = (c.env.ENVIRONMENT as Environment) || "local";

	if (environment === "test") {
		c.set("user", { id: "test-user", email: "test@example.com", name: "Test User" } as AppUser);
		return next();
	}

	const auth = createAuth(c);
	const session = await auth.api.getSession({ headers: c.req.raw.headers });

	if (!session) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	c.set("user", session.user);
	c.set("session", session.session);
	return next();
}

export async function handleAuthRequest(c: AppContext) {
	try {
		const path = c.req.path;
		const isSignUpPath = path.includes("/sign-up");
		if (!config.auth.enableSignups && isSignUpPath) {
			return c.json({ error: "Signups are disabled" }, 403);
		}

		const auth = createAuth(c);
		const response = await auth.handler(c.req.raw);
		return response;
	} catch (error: unknown) {
		return c.json(
			{
				error: "Authentication error",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			500,
		);
	}
}
