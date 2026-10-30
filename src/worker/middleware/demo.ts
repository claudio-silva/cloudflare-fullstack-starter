import { Hono } from "hono";
import type { AppBindings, AppContext } from "../types/context";
import type { AppEnv } from "../types/env";
import { fail, failForAuthClient } from "../lib/errors";

/**
 * Demo mode: the app as a public, read-only showcase.
 *
 * Turned on by the `DEMO_MODE` secret, which lives on the deployed Worker and
 * never in the repository — so a project created from the template is never
 * in demo mode, and has nothing to switch off.
 *
 * A public deployment with a published password is an invitation to abuse.
 * What closes it:
 *
 *  - **Read-only.** Every write under `/api/` is refused, except signing in
 *    and out. Nobody can change the demo account's password or email, delete
 *    it, sign up, or store anything — which also means the data never grows
 *    and needs no periodic reset.
 *  - **No email.** Sign-up, password reset and verification are writes, so
 *    they are refused before any email could be sent; the email adapter is a
 *    no-op as well (src/worker/adapters/email), in case a path is ever missed.
 *    An app that sends mail on behalf of strangers is a spam relay.
 *  - **Sign-in rate limit** per IP (`AUTH_RATE_LIMITER`, see src/worker/index.ts),
 *    which on `*.workers.dev` has to be in the Worker: there is no zone, so
 *    no WAF or dashboard rate-limiting rule applies.
 *  - **Visitors' addresses stay private.** Every visitor signs in to the same
 *    account, so its sessions and sign-in log hold strangers' IPs: the admin
 *    area shows them masked (`maskIp`), and Better Auth's session list, which
 *    the UI does not use, is refused.
 *
 * The credentials are served by `GET /api/demo` so the sign-in form can offer
 * them; that route answers 404 outside demo mode.
 */

export const isDemo = (env: Pick<AppEnv, "DEMO_MODE">) => env.DEMO_MODE === "1" || env.DEMO_MODE === "true";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Writes the demo still accepts. */
const ALLOWED_WRITES = [
	"/api/auth/sign-in/", // signing in…
	"/api/auth/sign-out", // …and out
	"/api/client-errors", // the browser's error reports (rate-limited on their own)
	"/api/cli/", // the deploy's migrations; protected by CLI_API_KEY
];

/** Reads the demo refuses: they would show other visitors' sessions, with their IPs. */
const HIDDEN_READS = ["/api/auth/list-sessions"];

/** In demo mode, an IP with its last part hidden (`203.0.113.x`, `2001:db8:85a3::x`); otherwise as is. */
export function demoIp(env: Pick<AppEnv, "DEMO_MODE">, ip: string | null): string | null {
	return ip && isDemo(env) ? maskIp(ip) : ip;
}

export function maskIp(ip: string): string {
	if (ip.includes(".")) return ip.replace(/\.[^.:]*$/, ".x");
	const head = ip.split("::")[0].split(":").filter(Boolean).slice(0, 3);
	return `${head.join(":")}::x`;
}

export async function demoMiddleware(c: AppContext, next: () => Promise<void>) {
	if (isDemo(c.env) && HIDDEN_READS.includes(c.req.path)) {
		return failForAuthClient(c, 403, "This is a public demo: sessions are not listed.", { code: "demo_hidden", level: "info", log: `demo: refused ${c.req.method} ${c.req.path}` });
	}
	if (!isDemo(c.env) || SAFE_METHODS.has(c.req.method) || !c.req.path.startsWith("/api/")) return next();
	if (ALLOWED_WRITES.some((prefix) => c.req.path.startsWith(prefix))) return next();

	const message = "This is a read-only demo: changes are not saved.";
	const options = { code: "demo_read_only", level: "info", log: `demo: refused ${c.req.method} ${c.req.path}` } as const;
	return c.req.path.startsWith("/api/auth/") ? failForAuthClient(c, 403, message, options) : fail(c, 403, message, options);
}

/** `GET /api/demo`: the demo account, for the sign-in form. */
export const demo = new Hono<AppBindings>();

demo.get("/", (c) => {
	if (!isDemo(c.env) || !c.env.DEMO_EMAIL || !c.env.DEMO_PASSWORD) {
		return fail(c, 404, "Not found.", { code: "not_found" });
	}
	return c.json({ email: c.env.DEMO_EMAIL, password: c.env.DEMO_PASSWORD });
});
