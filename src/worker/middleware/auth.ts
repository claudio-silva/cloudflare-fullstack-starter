import { betterAuth } from "better-auth";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Context } from "hono";
import bcrypt from "bcryptjs";
import type { Database } from "../types/database";
import { createResendEmailSender, getResend } from "../utils/resend";
import { getVerificationEmailTemplate } from "../utils/email-templates";

type Environment = "local" | "preview" | "production";

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

export function createAuth(c: Context) {
	const environment: Environment = (c.env.ENVIRONMENT as Environment) || "local";
	const d1Db = c.env.DB;

	if (!d1Db) {
		throw new Error("Database binding (DB) is not available");
	}

	const db = new Kysely<Database>({
		dialect: new D1Dialect({ database: d1Db }),
	});

	const emailSender = c.env.RESEND_API_KEY ? createResendEmailSender(c.env) : null;

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
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: environment !== "local",
			password: {
				hash: async (password) => bcrypt.hash(password, 10),
				verify: async ({ hash, password }) => bcrypt.compare(password, hash),
			},
		},
		emailVerification: {
			sendOnSignUp: environment !== "local",
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

export async function authMiddleware(c: Context, next: () => Promise<void>) {
	const environment: Environment = (c.env.ENVIRONMENT as Environment) || "local";

	if (environment === "test") {
		c.set("user", { id: "test-user", email: "test@example.com", name: "Test User" } as any);
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

export async function handleAuthRequest(c: Context) {
	try {
		const auth = createAuth(c);
		const response = await auth.handler(c.req.raw);
		return response;
	} catch (error: any) {
		return c.json(
			{
				error: "Authentication error",
				message: error?.message || "Unknown error",
			},
			500,
		);
	}
}
