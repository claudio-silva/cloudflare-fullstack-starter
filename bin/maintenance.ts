#!/usr/bin/env tsx
/**
 * Take the app out of service, and put it back.
 *
 * Both mechanisms live at the **zone** level, outside the Worker. That is the
 * whole point: an in-app flag needs the Worker healthy enough to read it and
 * render a page, which is precisely what you cannot count on during an
 * incident. It also costs nothing per request — no storage read in the hot path.
 *
 *   redirect  Single Redirect rule, 302 to a page you host elsewhere.
 *             Available on every zone plan, including Free.
 *   snippet   Snippet returning a real 503 with Retry-After. Correct
 *             semantics, but Snippets require a Pro zone or above.
 *
 * `deployConfig.maintenance.bypassPaths` (default `/api/cli/`) stays reachable,
 * so migrations and failure reports still work while the app is down.
 *
 * Credentials: CLOUDFLARE_API_TOKEN from the environment or .env.setup.local.
 * The token needs zone-level rule permissions, which the Workers-scoped token
 * from `bin/init` does NOT have — see docs/DEPLOYMENT.md.
 *
 * Usage:
 *   tsx bin/maintenance.ts <on|off|status> --env <preview|production> [--dry-run]
 */

import { loadDeployConfig, cloudflareCredentials, type DeployEnv } from "./lib/deploy-config";

const CF_API = "https://api.cloudflare.com/client/v4";
/** Marks the rules we own, so other rules in the same ruleset are never touched. */
const MARKER = "maintenance (managed by bin/maintenance.ts)";
const SNIPPET_NAME = "maintenance";

type CfResponse<T> = { success?: boolean; result?: T; errors?: { message: string }[] };

/** Carries the HTTP status so callers can tell "not there yet" from "not allowed". */
class CfError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

async function cf<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${CF_API}${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = (await res.json().catch(() => null)) as CfResponse<T> | null;
	if (!res.ok || !json?.success) {
		const detail = json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
		throw new CfError(`${method} ${path}: ${detail}`, res.status);
	}
	return json.result as T;
}

/** Matches the hostname, minus the paths that must stay reachable. */
function buildExpression(hostname: string, bypassPaths: readonly string[]): string {
	const clauses = [`http.host eq "${hostname}"`];
	for (const path of bypassPaths) {
		clauses.push(`not starts_with(http.request.uri.path, "${path}")`);
	}
	return `(${clauses.join(" and ")})`;
}

function maintenanceHtml(hostname: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Temporarily unavailable</title>
<style>
  body { font-family: system-ui, sans-serif; display: grid; place-items: center;
         min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 .75rem; }
  p { margin: 0; color: #94a3b8; line-height: 1.6; }
</style>
</head>
<body><main>
  <h1>Temporarily unavailable</h1>
  <p>${hostname} is being updated and will be back in a few minutes.</p>
</main></body>
</html>`;
}

type RulesetRule = { id?: string; description?: string; enabled?: boolean; [k: string]: unknown };
type Ruleset = { id: string; rules?: RulesetRule[] };

/** The API returns fields it refuses on write; echoing them back fails the PUT. */
const SERVER_MANAGED = ["id", "version", "last_updated", "ref"] as const;
function forWriting(rule: RulesetRule): RulesetRule {
	const out: RulesetRule = {};
	for (const [key, value] of Object.entries(rule)) {
		if (!SERVER_MANAGED.includes(key as (typeof SERVER_MANAGED)[number])) out[key] = value;
	}
	return out;
}

async function redirectEntrypoint(token: string, zoneId: string): Promise<Ruleset> {
	const phase = "http_request_dynamic_redirect";
	try {
		return await cf<Ruleset>(token, "GET", `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`);
	} catch (error) {
		// Only a missing ruleset justifies creating one. Anything else — above
		// all a 403 from a token without zone scope — must surface as itself,
		// or a permissions problem masquerades as "first run".
		if (!(error instanceof CfError) || error.status !== 404) throw error;
		return await cf<Ruleset>(token, "POST", `/zones/${zoneId}/rulesets`, {
			name: "default",
			kind: "zone",
			phase,
			rules: [],
		});
	}
}

async function applyRedirect(
	token: string,
	zoneId: string,
	expression: string,
	target: string,
	enabled: boolean,
	dryRun: boolean,
): Promise<void> {
	const ruleset = await redirectEntrypoint(token, zoneId);
	const others = (ruleset.rules ?? []).filter((r) => r.description !== MARKER);
	const ours: RulesetRule = {
		action: "redirect",
		action_parameters: {
			from_value: {
				status_code: 302,
				target_url: { value: target },
				preserve_query_string: false,
			},
		},
		expression,
		description: MARKER,
		enabled,
	};
	if (dryRun) {
		console.log(`[dry-run] PUT ruleset ${ruleset.id} with ${others.length} existing rule(s) + ours (enabled=${enabled})`);
		return;
	}
	const rules = [...others, ours].map(forWriting);
	await cf(token, "PUT", `/zones/${zoneId}/rulesets/${ruleset.id}`, { rules });
}

/** Snippet rules, or an empty list when the zone has none yet (404). */
async function snippetRules(token: string, zoneId: string): Promise<RulesetRule[]> {
	try {
		const res = await cf<{ rules?: RulesetRule[] }>(token, "GET", `/zones/${zoneId}/snippets/snippet_rules`);
		return res.rules ?? [];
	} catch (error) {
		if (error instanceof CfError && error.status === 404) return [];
		throw error;
	}
}

async function uploadSnippet(token: string, zoneId: string, hostname: string): Promise<void> {
	const code = `const BODY = ${JSON.stringify(maintenanceHtml(hostname))};
export default {
  async fetch() {
    return new Response(BODY, {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "retry-after": "300" },
    });
  },
};
`;
	const form = new FormData();
	form.append("files", new Blob([code], { type: "application/javascript+module" }), "maintenance.js");
	form.append("metadata", JSON.stringify({ main_module: "maintenance.js" }));
	const res = await fetch(`${CF_API}/zones/${zoneId}/snippets/${SNIPPET_NAME}`, {
		method: "PUT",
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	});
	const json = (await res.json().catch(() => null)) as CfResponse<unknown> | null;
	if (!res.ok || !json?.success) {
		const detail = json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
		throw new Error(`PUT /zones/${zoneId}/snippets/${SNIPPET_NAME}: ${detail}`);
	}
}

async function applySnippet(
	token: string,
	zoneId: string,
	hostname: string,
	expression: string,
	enabled: boolean,
	dryRun: boolean,
): Promise<void> {
	if (dryRun) {
		console.log(`[dry-run] upload snippet "${SNIPPET_NAME}" and set its rule (enabled=${enabled})`);
		return;
	}
	await uploadSnippet(token, zoneId, hostname);
	const existing = await snippetRules(token, zoneId);
	const others = existing.filter((r) => r.description !== MARKER);
	const rules = [
		...others.map(forWriting),
		{ expression, enabled, snippet_name: SNIPPET_NAME, description: MARKER },
	];
	await cf(token, "PUT", `/zones/${zoneId}/snippets/snippet_rules`, { rules });
}

async function readStatus(
	token: string,
	zoneId: string,
	mechanism: "redirect" | "snippet",
): Promise<boolean | null> {
	const rules =
		mechanism === "redirect"
			? ((await redirectEntrypoint(token, zoneId)).rules ?? [])
			: await snippetRules(token, zoneId);
	const ours = rules.find((r) => r.description === MARKER);
	return ours ? ours.enabled === true : null;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const action = args[0];
	if (!action || !["on", "off", "status"].includes(action)) {
		console.error("Usage: tsx bin/maintenance.ts <on|off|status> --env <preview|production> [--dry-run]");
		process.exit(1);
	}
	const envIdx = args.indexOf("--env");
	const env = (envIdx === -1 ? "production" : args[envIdx + 1]) as DeployEnv;
	if (env !== "preview" && env !== "production") {
		console.error(`Unknown environment "${env}" (expected preview or production)`);
		process.exit(1);
	}
	const dryRun = args.includes("--dry-run");
	const cfg = loadDeployConfig(env);
	const { mechanism, zoneId, hostname, redirectTo, bypassPaths } = cfg.maintenance;

	if (mechanism === "none") {
		console.log(`ℹ Maintenance mode is disabled for ${env} (mechanism "none"). Nothing to do.`);
		console.log("  Zone-level rules need a custom domain; *.workers.dev is not part of a zone.");
		return;
	}
	if (!zoneId) throw new Error(`No zone id configured for ${env}. Set maintenance.zoneId in deploy.config.ts.`);
	if (!hostname) {
		throw new Error(
			`No hostname for ${env}. Add a route under [env.${env}] in wrangler.toml, or set maintenance.hostname.${env}.`,
		);
	}
	// `status` only reads, so it must work even before a target is configured.
	if (action !== "status" && mechanism === "redirect" && !redirectTo) {
		throw new Error('mechanism "redirect" needs maintenance.redirectTo — a page hosted outside this Worker.');
	}

	const { token } = cloudflareCredentials();
	if (!token) {
		throw new Error("No CLOUDFLARE_API_TOKEN (environment or .env.setup.local). It needs zone rule permissions.");
	}

	if (action === "status") {
		const on = await readStatus(token, zoneId, mechanism);
		console.log(
			on === null
				? `○ ${hostname}: no maintenance rule yet (${mechanism})`
				: on
					? `● ${hostname}: MAINTENANCE IS ON (${mechanism})`
					: `○ ${hostname}: live (${mechanism} rule present but disabled)`,
		);
		return;
	}

	const enabled = action === "on";
	const expression = buildExpression(hostname, bypassPaths);
	if (mechanism === "redirect") {
		await applyRedirect(token, zoneId, expression, redirectTo, enabled, dryRun);
	} else {
		await applySnippet(token, zoneId, hostname, expression, enabled, dryRun);
	}
	console.log(
		enabled
			? `● Maintenance ON for ${hostname} (${mechanism}). Bypass: ${bypassPaths.join(", ")}`
			: `○ Maintenance OFF for ${hostname} (${mechanism}).`,
	);
}

main().catch((error: unknown) => {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
