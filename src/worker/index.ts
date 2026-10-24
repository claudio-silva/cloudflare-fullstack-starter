import { Hono } from "hono";
import type { AppBindings } from "./types/context";
import { handleAuthRequest } from "./middleware/auth";
import { cli } from "./routes/cli";
import { profile } from "./routes/profile";
import { config } from "../config";
import { APP_COMMIT, APP_VERSION } from "../shared/app-version";
import { createDb, databaseKind } from "./db";
import { isSignInPath, recordLoginAttempt } from "./lib/login-log";
import { scheduled } from "./scheduled";
import { migrateDatabase } from "./db/migrations";

/**
 * Better Auth rejects an internal promise nobody awaits on a failed password
 * sign-in: the 401 is returned correctly, but the rejection escapes. Left
 * alone the runtime reports it on every wrong password, which is both noise
 * in observability and, in some runtimes, a risk to the request context.
 *
 * We log rather than swallow — if something else ever rejects unhandled, it
 * is still visible in observability — and stop it from being treated as a
 * crash. Note this guard is NOT exercised by the test suite: the Vitest
 * Workers pool installs its own handler first, so the rejection it catches
 * there is not the one this sees in a deployed Worker.
 */
addEventListener("unhandledrejection", (event) => {
	console.error("[worker] unhandled promise rejection", event.reason);
	event.preventDefault();
});

// Growth pattern: add one file per feature under ./routes and mount it here
// with `app.route()`, instead of adding handlers to this file.
const app = new Hono<AppBindings>();

// Local development only: apply pending migrations on the first API request, so a fresh
// checkout works with `npm run dev` and no separate migrate step. Preview/production
// are migrated explicitly (`npm run db:migrate:preview` / `:production`).
let localMigration: Promise<unknown> | undefined;
app.use("/api/*", async (c, next) => {
	if (c.env.ENVIRONMENT === "local" && c.env.DB) {
		localMigration ??= migrateDatabase(createDb(c.env), { kind: databaseKind }).catch((error) => {
			localMigration = undefined;
			throw error;
		});
		await localMigration;
	}
	await next();
});

// Health check
app.get("/api/", (c) => {
	const environment = c.env.ENVIRONMENT || "local";
	return c.json({ name: config.appName, environment, status: "healthy", version: APP_VERSION, commit: APP_COMMIT });
});

// Auth routes. Sign-in attempts are recorded after the fact, through
// waitUntil: an audit record is never a reason to make a user wait, nor to
// turn a successful sign-in into an error because an insert failed.
app.all("/api/auth/*", async (c) => {
	const response = await handleAuthRequest(c);
	if (isSignInPath(c.req.path) && c.req.method === "POST") {
		const write = recordLoginAttempt(c, response.status < 400).catch((error: unknown) =>
			console.error("[auth] could not record the sign-in attempt", error),
		);
		// `executionCtx` is absent outside a real Worker invocation (tests,
		// some runtimes). Dropping the record there would make the log quietly
		// incomplete, so fall back to awaiting it.
		try {
			c.executionCtx.waitUntil(write);
		} catch {
			await write;
		}
	}
	return response;
});

app.route("/api/cli", cli);
app.route("/api", profile);

// Durable Object classes must be exported from the Worker entry.

/** The Hono app, for tests and anything that wants `app.request()`. */
export { app };

// The Worker entry is an object now, not the Hono app itself, because it also
// has to carry the cron handler.
export default {
	fetch: app.fetch,
	scheduled,
};
