import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Smoke E2E against the unified Vite + Worker dev server (http://localhost:5173).
// Requires a local `.env.local` (copy env/local.env.template) with
// AUTH_EMAILS_LOCAL_ENABLED=false so sign-up signs the user straight in.
//
// The address follows APP_BASE_URL in `.env.local` when it is a local URL, so
// a checkout whose dev server runs elsewhere (a Paseo worktree, see paseo.json)
// tests its own server rather than whichever one holds 5173.
const appBaseUrl = existsSync(".env.local")
	? readFileSync(".env.local", "utf-8").match(/^APP_BASE_URL=["']?(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/m)?.[1]
	: undefined;
const baseURL = appBaseUrl ?? "http://localhost:5173";
const port = new URL(baseURL).port;
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL,
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		// The dev server applies pending local migrations on its first API request.
		command: `npm run dev -- --port ${port} --strictPort`,
		url: `${baseURL}/api/`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
