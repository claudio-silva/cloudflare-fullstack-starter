import { D1Dialect } from "kysely-d1";

export type D1DatabaseType = ConstructorParameters<typeof D1Dialect>[0]["database"];

export type AppEnv = {
	ASSETS?: Fetcher;
	DB: D1DatabaseType;
	ENVIRONMENT?: string;
	AUTH_EMAILS_LOCAL_ENABLED?: string;
	// Cloudflare Email Service binding (`[[send_email]]` in wrangler.toml).
	EMAIL?: SendEmail;
	// Better Auth signing/encryption secret. Required in preview/production.
	// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
	BETTER_AUTH_SECRET?: string;
	// Public base URL of the app (used by Better Auth for session/OAuth/email links).
	// Optional — falls back to sensible defaults per environment.
	APP_BASE_URL?: string;
	// Google OAuth credentials (optional)
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	// "1" takes the app out of service (src/worker/middleware/maintenance.ts).
	// Set by the deploy for a breaking migration; absent the rest of the time.
	MAINTENANCE?: string;
	// Days of sign-in history kept by the cron in src/worker/scheduled.ts (default 90).
	AUTH_LOG_RETENTION_DAYS?: string;
	// Shared secret used by management CLI (`npm run auth …`) to authenticate
	// against `/api/cli/*`. Must be set in every environment.
	CLI_API_KEY?: string;
	// Optional Workers Rate Limiting binding for POST /api/client-errors
	// (src/worker/routes/client-errors.ts). Without it a per-isolate budget applies.
	CLIENT_ERRORS_RATE_LIMITER?: RateLimit;
	// Optional Workers Rate Limiting binding for every POST under /api/auth/
	// (sign-in, sign-up, password reset), keyed by IP. See wrangler.toml.
	AUTH_RATE_LIMITER?: RateLimit;
	// "1" turns on demo mode (src/worker/middleware/demo.ts): read-only, no email.
	// A secret on the demo Worker only — never set it in wrangler.toml.
	DEMO_MODE?: string;
	// The demo account, offered on the sign-in form in demo mode.
	DEMO_EMAIL?: string;
	DEMO_PASSWORD?: string;
};
