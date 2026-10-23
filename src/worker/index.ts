import { Hono } from "hono";
import type { AppBindings } from "./types/context";
import { handleAuthRequest } from "./middleware/auth";
import { cli } from "./routes/cli";
import { profile } from "./routes/profile";
import { exampleCounter } from "./routes/example-counter";
import { config } from "../config";
import { APP_COMMIT, APP_VERSION } from "../shared/app-version";
import { createDb, databaseKind } from "./db";
import { migrateDatabase } from "./db/migrations";

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

// Auth routes
app.all("/api/auth/*", (c) => handleAuthRequest(c));

app.route("/api/cli", cli);
app.route("/api", profile);
app.route("/api/counter", exampleCounter);

// Durable Object classes must be exported from the Worker entry.
export { ExampleCounter } from "./durable-objects/ExampleCounter";

export default app;
