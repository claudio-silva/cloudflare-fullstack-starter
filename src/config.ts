/**
 * Application Configuration
 *
 * This file contains global configuration settings that are shared across
 * both the frontend (React) and backend (Cloudflare Worker).
 *
 * For environment-specific settings (like API URLs), use:
 * - wrangler.toml [vars] for backend environment variables
 * - .env files for secrets (BETTER_AUTH_SECRET, CLI_API_KEY, adapter API keys, etc.)
 *
 * For deployment-specific settings, see wrangler.toml environments.
 */

export const config = {
	// Application name - displayed in UI, emails, and page titles
	appName: "My App",

	// The browser's HTTP layer (src/react-app/lib/http/, docs/MECHANISMS.md)
	http: {
		// Send the browser's uncaught errors and failed requests to the Worker
		// logs (POST /api/client-errors), where `wrangler tail` and Workers Logs show them.
		reportClientErrors: true,
	},

	// Auth settings
	auth: {
		// Toggle self-serve signups (hides link and route when false)
		enableSignups: true,
		// Enable Google OAuth sign-in (requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars)
		enableGoogleAuth: true,
	},

	// Public base URLs per environment (fallbacks when APP_BASE_URL is not set).
	// `npm run init` updates these.
	baseUrls: {
		local: "http://localhost:5173",
		preview: "https://preview.example.com",
		production: "https://app.example.com",
	},

	// Email settings
	email: {
		// Email adapter: "cloudflare" (Cloudflare Email Service via the `EMAIL`
		// binding). Other providers can be added as adapters in
		// src/worker/adapters/email (see docs/EMAIL.md).
		provider: "cloudflare",
		// The "from" address for outgoing emails. It must be allowed by the
		// provider: for "cloudflare", a domain onboarded in Cloudflare and listed
		// in wrangler.toml `allowed_sender_addresses`; for other adapters, whatever the provider requires.
		fromAddress: "noreply@example.com",
		// Where a failed deploy reports itself. Deliberately configured here and
		// not taken from the request: otherwise anyone holding CLI_API_KEY could
		// make the app send mail to an address of their choosing. Empty disables
		// the report (CI still fails loudly on its own).
		deployReportsTo: "",
	},
} as const;

// Type export for TypeScript consumers
export type AppConfig = typeof config;
