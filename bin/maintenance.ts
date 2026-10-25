#!/usr/bin/env tsx
/**
 * Pull the app offline in an emergency, and put it back. The equivalent of
 * `artisan down`, for when something is wrong right now.
 *
 * A Single Redirect rule at the **zone** level, outside the Worker. That is
 * the whole point: it still works when the Worker itself is what is broken or
 * compromised, and it is one API call rather than a build and a deploy — about
 * five seconds, not ninety.
 *
 * For a *planned* window — the deploy of a `breaking` migration — do not use
 * this. The `MAINTENANCE` var handles that case better: the URL does not
 * change, the response is a real 503 the client can act on, and the browser
 * can simply retry. See `src/worker/middleware/maintenance.ts`. The deploy
 * sets it on its own; there is nothing to run by hand.
 *
 * The trade here is honest: a redirect changes the URL, so the user cannot
 * just refresh. In an emergency that is the least of the problems.
 *
 * `deployConfig.maintenance.bypassPaths` (default `/api/cli/`) and
 * `bypassExactPaths` (default `/api/`) stay reachable, so migrations, failure
 * reports and the deploy's own version check still work.
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
function buildExpression(
	hostname: string,
	bypassPaths: readonly string[],
	bypassExactPaths: readonly string[],
): string {
	const clauses = [`http.host eq "${hostname}"`];
	for (const path of bypassPaths) {
		clauses.push(`not starts_with(http.request.uri.path, "${path}")`);
	}
	for (const path of bypassExactPaths) {
		clauses.push(`http.request.uri.path ne "${path}"`);
	}
	return `(${clauses.join(" and ")})`;
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

async function readStatus(token: string, zoneId: string): Promise<boolean | null> {
	const rules = (await redirectEntrypoint(token, zoneId)).rules ?? [];
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
	const { mechanism, zoneId, hostname, redirectTo, bypassPaths, bypassExactPaths } = cfg.maintenance;

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
	if (action !== "status" && !redirectTo) {
		throw new Error('mechanism "redirect" needs maintenance.redirectTo — a page hosted outside this Worker.');
	}

	const { token } = cloudflareCredentials();
	if (!token) {
		throw new Error("No CLOUDFLARE_API_TOKEN (environment or .env.setup.local). It needs zone rule permissions.");
	}

	if (action === "status") {
		const on = await readStatus(token, zoneId);
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
	const expression = buildExpression(hostname, bypassPaths, bypassExactPaths);
	await applyRedirect(token, zoneId, expression, redirectTo, enabled, dryRun);
	console.log(
		enabled
			? `● Maintenance ON for ${hostname} (${mechanism}). Bypass: ${[...bypassPaths, ...bypassExactPaths].join(", ")}`
			: `○ Maintenance OFF for ${hostname} (${mechanism}).`,
	);
}

main().catch((error: unknown) => {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
