import type { AppContext } from "../types/context";
import { config } from "../../config";
import { MAINTENANCE_HEADER } from "../../shared/http-contract";

/**
 * Take the app out of service from inside the Worker, driven by the
 * `MAINTENANCE` var.
 *
 * Why a var and not a stored flag: a var is baked into the Worker version and
 * read from memory, so it costs nothing per request. An earlier design put the
 * flag in KV or a Durable Object and paid a storage read on every request —
 * for something that is off essentially all the time.
 *
 * The cost is that switching it needs a deploy. That is free in the case this
 * exists for: a migration window is wrapped around a deploy anyway.
 *
 * This does NOT replace the zone-level mechanism (`npm run maintenance`). This
 * one needs the Worker to be healthy enough to answer, which is exactly what an
 * incident takes away. Use this for planned windows, that for emergencies.
 */

/** Marks a maintenance response so the client can tell it from any other 503. */
export { MAINTENANCE_HEADER };

/**
 * Paths that answer normally while the app is down.
 *
 * `/api/` is not optional: `deploy:production` polls it to confirm the released
 * version is live. A window that hid it would make every deploy inside one time
 * out, with the deploy itself having worked. `/api/cli/` carries the migrations
 * the window was opened for.
 */
const EXACT_BYPASS = ["/api/"];
const PREFIX_BYPASS = ["/api/cli/"];

export function isMaintenanceBypassed(path: string): boolean {
	return EXACT_BYPASS.includes(path) || PREFIX_BYPASS.some((p) => path.startsWith(p));
}

function wantsJson(accept: string): boolean {
	return accept.includes("application/json");
}

function wantsHtml(accept: string): boolean {
	return accept.includes("text/html");
}

function maintenancePage(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Temporarily unavailable — ${config.appName}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; display: grid; place-items: center;
         min-height: 100vh; margin: 0; }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 .75rem; }
  p { margin: 0; opacity: .75; line-height: 1.6; }
</style>
</head>
<body><main>
  <h1>Temporarily unavailable</h1>
  <p>${config.appName} is being updated and will be back in a few minutes. This page retries itself.</p>
  <script>setTimeout(function () { location.reload(); }, 15000);</script>
</main></body>
</html>`;
}

export async function maintenanceMiddleware(c: AppContext, next: () => Promise<void>) {
	if (c.env.MAINTENANCE !== "1" || isMaintenanceBypassed(c.req.path)) return next();

	const accept = c.req.header("Accept") ?? "";
	const headers: Record<string, string> = {
		[MAINTENANCE_HEADER]: "1",
		// Tells crawlers and monitoring this is temporary, which a redirect cannot.
		"Retry-After": "60",
		"Cache-Control": "no-store",
	};

	// Ordered deliberately: a browser navigation sends both text/html and
	// */*, so HTML has to be checked before the catch-all, and an XHR asking
	// for JSON must never receive a page it cannot parse.
	if (wantsJson(accept)) {
		return c.json({ error: "Service unavailable", code: "maintenance" }, 503, headers);
	}
	if (wantsHtml(accept)) {
		return c.html(maintenancePage(), 503, headers);
	}
	return c.body(null, 503, headers);
}
