import { D1Dialect } from "kysely-d1";

export type D1DatabaseType = ConstructorParameters<typeof D1Dialect>[0]["database"];

export type EmailProvider = "cloudflare" | "resend";

export type CloudflareEmailSendBinding = {
	send(message: EmailMessage): Promise<{ messageId: string }>;
};

export type AppEnv = {
	DB: D1DatabaseType;
	ENVIRONMENT?: string;
	EMAIL_PROVIDER?: EmailProvider;
	EMAIL_API_KEY?: string;
	AUTH_EMAILS_LOCAL_ENABLED?: string;
	SEND_EMAIL?: CloudflareEmailSendBinding;
	// Public base URL of the app (used by Better Auth for session/OAuth/email links).
	// Optional — falls back to sensible defaults per environment.
	APP_BASE_URL?: string;
	// Google OAuth credentials (optional)
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	// Shared secret used by management CLI (`npm run auth …`) to authenticate
	// against `/api/cli/*`. Must be set in every environment.
	CLI_API_KEY?: string;
};
