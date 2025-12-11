/**
 * Application Configuration
 *
 * This file contains global configuration settings that are shared across
 * both the frontend (React) and backend (Cloudflare Worker).
 *
 * For environment-specific settings (like API URLs), use:
 * - wrangler.toml [vars] for backend environment variables
 * - .env files for secrets (RESEND_API_KEY, etc.)
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
	},

	// Email settings
	email: {
		// The "from" address for outgoing emails
		// Note: This domain must be verified with your email provider (e.g., Resend)
		fromAddress: "noreply@example.com",
	},
} as const;

// Type export for TypeScript consumers
export type AppConfig = typeof config;


