/**
 * Application Configuration
 *
 * This file contains global configuration settings that are shared across
 * both the frontend (React) and backend (Cloudflare Worker).
 *
 * For environment-specific settings (like API URLs), use:
 * - wrangler.toml [vars] for backend environment variables
 * - .env files for secrets (EMAIL_API_KEY, etc.)
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

	// Email settings
	email: {
		// Default email provider when EMAIL_PROVIDER is not set.
		defaultProvider: "cloudflare",
		// The "from" address for outgoing emails
		// Note: This address must be allowed by the active email provider.
		fromAddress: "noreply@example.com",
	},
} as const;

// Type export for TypeScript consumers
export type AppConfig = typeof config;
