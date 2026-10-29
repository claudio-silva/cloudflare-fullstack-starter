import { Hono } from "hono";
import type { AppBindings } from "./types/context";
import { createAuth, handleAuthRequest } from "./middleware/auth";
import { cli } from "./routes/cli";
import { profile } from "./routes/profile";
import { admin } from "./routes/admin"; // [admin-area-line]
import { config } from "../config";
import { APP_COMMIT, APP_VERSION } from "../shared/app-version";
import { createDb, databaseKind } from "./db";
import { isSignInPath, isSignOutPath, recordLoginAttempt, recordSignOut } from "./lib/login-log";
import { maintenanceMiddleware } from "./middleware/maintenance";
import { versionMiddleware } from "./middleware/version";
import { clientErrors } from "./routes/client-errors";
import { demo, demoMiddleware } from "./middleware/demo";
import { AppError, errorResponse, failForAuthClient } from "./lib/errors";
import { CLIENT_ERRORS_PATH } from "../shared/http-contract";
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

// First of all: every response, including maintenance and error responses,
// carries the server's version, and every request gets an id.
app.use("*", versionMiddleware);

// Every error leaves the Worker in one shape, `ApiErrorBody` — what the user
// is told, separate from what is logged. Throw `AppError` (or return `fail()`)
// from a handler; anything else thrown is a bug and becomes a generic 500.
// See src/worker/lib/errors.ts.
app.onError((error, c) => errorResponse(c, error));
app.notFound((c) => errorResponse(c, new AppError(404, "Not found.", { code: "not_found", log: `no route for ${c.req.method} ${c.req.path}` })));

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

// Must come before every route: while MAINTENANCE=1 the app answers 503 to
// everything except the health endpoint and the CLI routes the migration needs.
app.use("*", maintenanceMiddleware);

// Public read-only showcase, when the DEMO_MODE secret is set; inert otherwise.
// See src/worker/middleware/demo.ts.
app.use("*", demoMiddleware);

// Health check
app.get("/api/", (c) => {
	const environment = c.env.ENVIRONMENT || "local";
	return c.json({ name: config.appName, environment, status: "healthy", version: APP_VERSION, commit: APP_COMMIT });
});

// What an open tab polls to learn the app is back from maintenance. Unlike
// `/api/` above it is NOT exempt from either mechanism, and must not become
// so: a probe that answers during the window reports a recovery that has not
// happened. See src/react-app/lib/http/maintenance.ts.
app.get("/api/ping", (c) => c.body(null, 204, { "Cache-Control": "no-store" }));

// Auth routes. Sign-in attempts are recorded after the fact, through
// waitUntil: an audit record is never a reason to make a user wait, nor to
// turn a successful sign-in into an error because an insert failed.
app.all("/api/auth/*", async (c) => {
	// Brute force and sign-up floods: every auth write is limited per IP when the
	// AUTH_RATE_LIMITER binding exists (wrangler.toml). On *.workers.dev this is
	// the only rate limit there is — no zone, so no WAF rules.
	const limiter = c.env.AUTH_RATE_LIMITER;
	if (limiter && c.req.method === "POST") {
		const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
		if (!(await limiter.limit({ key: ip })).success) {
			return failForAuthClient(
				c,
				429,
				"Too many attempts. Please wait a minute and try again.",
				{ code: "rate_limited", log: `auth rate limit for ${ip}` },
				{ "Retry-After": "60" },
			);
		}
	}
	// Signing out deletes the session, so who is signing out is read first.
	const signingOut =
		isSignOutPath(c.req.path) && c.req.method === "POST"
			? (await createAuth(c).api.getSession({ headers: c.req.raw.headers }).catch(() => null))?.user
			: undefined;
	const response = await handleAuthRequest(c);
	const record =
		isSignInPath(c.req.path) && c.req.method === "POST"
			? recordLoginAttempt(c, response.status < 400)
			: signingOut && response.status < 400
				? recordSignOut(c, signingOut)
				: undefined;
	if (record) {
		const write = record.catch((error: unknown) => console.error("[auth] could not record the event", error));
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
app.route(CLIENT_ERRORS_PATH, clientErrors);
app.route("/api/demo", demo);
app.route("/api/admin", admin); // [admin-area-line]
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
