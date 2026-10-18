/**
 * Application Configuration
 *
 * This file contains global configuration settings that are shared across
 * both the frontend (React) and backend (Cloudflare Worker).
 *
 * For environment-specific settings (like API URLs), use:
 * - wrangler.toml [vars] for backend environment variables
 * - .env files for secrets (BETTER_AUTH_SECRET, CLI_API_KEY, etc.)
 *
 * For deployment-specific settings, see wrangler.toml environments.
 */

export const config = {
	// Application name - displayed in UI, emails, and page titles
	appName: "My App",

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
		// The "from" address for outgoing emails (Cloudflare Email Service).
		// Must be on a domain onboarded in Cloudflare and listed in
		// wrangler.toml `allowed_sender_addresses` (see docs/EMAIL.md).
		fromAddress: "noreply@example.com",
	},
} as const;

// Type export for TypeScript consumers
export type AppConfig = typeof config;
