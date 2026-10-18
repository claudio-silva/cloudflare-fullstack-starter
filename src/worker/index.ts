import { Hono } from "hono";
import type { AppBindings } from "./types/context";
import { handleAuthRequest } from "./middleware/auth";
import { cli } from "./routes/cli";
import { profile } from "./routes/profile";
import { exampleCounter } from "./routes/example-counter";
import { config } from "../config";

// Growth pattern: add one file per feature under ./routes and mount it here
// with `app.route()`, instead of adding handlers to this file.
const app = new Hono<AppBindings>();

// Health check
app.get("/api/", (c) => {
	const environment = c.env.ENVIRONMENT || "local";
	return c.json({ name: config.appName, environment, status: "healthy" });
});

// Auth routes
app.all("/api/auth/*", (c) => handleAuthRequest(c));

app.route("/api/cli", cli);
app.route("/api", profile);
app.route("/api/counter", exampleCounter);

// Durable Object classes must be exported from the Worker entry.
export { ExampleCounter } from "./durable-objects/ExampleCounter";

export default app;
