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
		// After "Postpone" on the new-version dialog, the minutes the user has
		// left on the old version before the tab updates itself. A banner counts
		// them down; navigating to another page updates sooner.
		updateGraceMinutes: 10,
	},

	// Auth settings
	auth: {
		// Toggle self-serve signups (hides link and route when false)
		enableSignups: true,
		// Google OAuth sign-in. Off until the credentials exist: `npm run setup:google`
		// creates them, fills GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in each
		// .env.<env> and turns this on. The button only ever appears where the
		// Worker has both credentials, so a half-done setup shows nothing rather
		// than a button that does nothing. See docs/GOOGLE_AUTH.md.
		enableGoogleAuth: false,
		session: {
			// Time without a normal request before a session dies. Every normal request
			// pushes the expiry this far ahead; a `background` route (worker/lib/route-kind.ts)
			// never does, so polling cannot keep a session alive.
			idleTimeoutSeconds: 60 * 60 * 12,
			// How often a normal request pushes the expiry forward. This is also the
			// "last seen" granularity in the admin area (Active / Idle): a minute costs
			// one small write per active session, a day would leave it a day stale.
			refreshAfterSeconds: 60,
		},
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
