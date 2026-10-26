import { Hono } from "hono";
import { z } from "zod";
import { CLIENT_ERROR_LIMITS as L } from "../../shared/http-contract";
import { clientVersionOf } from "../middleware/version";
import type { AppBindings } from "../types/context";

/**
 * Errors from users' browsers, written to the Worker logs.
 *
 * Without this, a developer learns about a client-side failure only when a
 * user complains — if they do. With it, `wrangler tail` or Workers Logs shows
 * every uncaught error, failed request and broken chunk load, with the page
 * and the client version, filterable on `source: "client"`.
 *
 * The endpoint is necessarily open — the errors that matter most can happen
 * before sign-in — so it is built to be useless to abuse:
 *
 *  - Same-origin only. A browser on another site cannot post here (no CORS),
 *    and a request without our Origin is dropped. That stops drive-by floods
 *    from visitors of a hostile page; it does not stop a script, which is what
 *    the next three are for.
 *  - Everything is bounded: body size checked before parsing, batch size, and
 *    every string truncated. One request can write at most one small batch.
 *  - Rate limited per IP: a Workers Rate Limiting binding when one is
 *    configured (`CLIENT_ERRORS_RATE_LIMITER`, see docs/MECHANISMS.md), which
 *    holds across all of Cloudflare; otherwise a per-isolate budget, which is
 *    weaker but costs nothing and still caps a burst.
 *  - It always answers 204, accepted or not, so probing it teaches nothing.
 *
 * Nothing is stored: logs only. A database table here would turn log spam
 * into storage cost and a write per request.
 */

const truncate = (max: number) => z.string().transform((s) => (s.length > max ? `${s.slice(0, max)}…` : s));

const reportSchema = z.object({
	kind: z.enum(["error", "unhandledrejection", "http", "chunk"]),
	message: truncate(L.message),
	stack: truncate(L.stack).optional(),
	page: truncate(L.url),
	request: z
		.object({
			method: z.string().max(10),
			url: truncate(L.url),
			status: z.number().int().min(0).max(999),
			requestId: z.string().max(100).optional(),
		})
		.optional(),
	at: z.number(),
});

const batchSchema = z.object({ reports: z.array(reportSchema).min(1).max(L.reportsPerBatch) });

/** Per isolate: an isolate serves many requests, so this caps a burst even without the binding. */
const WINDOW_MS = 60_000;
const PER_IP_PER_WINDOW = 20;
const PER_ISOLATE_PER_WINDOW = 500;
let windowStart = 0;
let isolateCount = 0;
const perIp = new Map<string, number>();

function withinIsolateBudget(ip: string, now = Date.now()): boolean {
	if (now - windowStart > WINDOW_MS) {
		windowStart = now;
		isolateCount = 0;
		perIp.clear();
	}
	const mine = (perIp.get(ip) ?? 0) + 1;
	perIp.set(ip, mine);
	isolateCount += 1;
	return mine <= PER_IP_PER_WINDOW && isolateCount <= PER_ISOLATE_PER_WINDOW;
}

/** For tests. */
export function resetClientErrorBudget(): void {
	windowStart = 0;
	isolateCount = 0;
	perIp.clear();
}

export const clientErrors = new Hono<AppBindings>();

clientErrors.post("/", async (c) => {
	const accepted = () => c.body(null, 204);

	const origin = c.req.header("Origin");
	if (!origin || origin !== new URL(c.req.url).origin) return accepted();

	const length = Number(c.req.header("Content-Length") ?? "0");
	if (!length || length > L.bodyBytes) return accepted();

	const ip = c.req.header("CF-Connecting-IP") ?? "local";
	const limiter = c.env.CLIENT_ERRORS_RATE_LIMITER;
	if (limiter) {
		if (!(await limiter.limit({ key: ip })).success) return accepted();
	} else if (!withinIsolateBudget(ip)) {
		return accepted();
	}

	const text = await c.req.text();
	if (text.length > L.bodyBytes) return accepted();
	let parsed: z.infer<typeof batchSchema>;
	try {
		const result = batchSchema.safeParse(JSON.parse(text));
		if (!result.success) return accepted();
		parsed = result.data;
	} catch {
		return accepted();
	}

	const context = {
		source: "client",
		clientVersion: clientVersionOf(c),
		userAgent: c.req.header("User-Agent")?.slice(0, 300),
		country: (c.req.raw as { cf?: { country?: string } }).cf?.country,
	};
	for (const report of parsed.reports) console.warn("[client]", { ...context, ...report });
	return accepted();
});
