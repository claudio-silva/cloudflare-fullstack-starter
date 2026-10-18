import { defineConfig, devices } from "@playwright/test";

// Smoke E2E against the unified Vite + Worker dev server (http://localhost:5173).
// Requires a local `.env.local` (copy env/local.env.template) with
// AUTH_EMAILS_LOCAL_ENABLED=false so sign-up signs the user straight in.
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: "http://localhost:5173",
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		// Apply local migrations, then start the dev server (reuses a running one locally).
		command: "npm run db:migrate && npm run dev -- --port 5173 --strictPort",
		url: "http://localhost:5173/api/",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
