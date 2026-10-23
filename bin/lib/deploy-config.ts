/**
 * Loader for `deploy.config.ts`: applies `.env.<environment>` overrides and
 * resolves values that are better derived than repeated (the hostname comes
 * from the routes already declared in wrangler.toml).
 *
 * Overrides, all optional, in `.env.<environment>`:
 *   DEPLOY_MODE, DEPLOY_BRANCH, DEPLOY_MAINTENANCE_MECHANISM,
 *   DEPLOY_MAINTENANCE_ZONE_ID, DEPLOY_MAINTENANCE_HOSTNAME,
 *   DEPLOY_MAINTENANCE_REDIRECT_TO, DEPLOY_NOTIFY_EMAIL
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { deployConfig, type DeployMode, type MaintenanceMechanism } from "../../deploy.config";

export type DeployEnv = "preview" | "production";

export type ResolvedDeployConfig = {
	mode: DeployMode;
	branch: string;
	notifyEmail: string;
	maintenance: {
		mechanism: MaintenanceMechanism;
		zoneId: string;
		hostname: string;
		redirectTo: string;
		bypassPaths: readonly string[];
	};
};

export function parseEnvFile(filePath: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!existsSync(filePath)) return out;
	for (const line of readFileSync(filePath, "utf-8").split("\n")) {
		const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
		if (!m) continue;
		let value = m[2];
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		out[m[1]] = value;
	}
	return out;
}

/** First route pattern declared under `[env.<name>]` in wrangler.toml, if any. */
export function routeHostname(tomlPath: string, env: DeployEnv): string {
	if (!existsSync(tomlPath)) return "";
	const root = parseToml(readFileSync(tomlPath, "utf-8")) as Record<string, unknown>;
	const envs = (root.env ?? {}) as Record<string, unknown>;
	const block = (envs[env] ?? {}) as Record<string, unknown>;
	const routes = block.routes;
	if (!Array.isArray(routes) || routes.length === 0) return "";
	const first = routes[0] as { pattern?: string } | string;
	const pattern = typeof first === "string" ? first : (first.pattern ?? "");
	// Route patterns may carry a path ("example.com/api/*"); the host is enough.
	return pattern.split("/")[0];
}

export function loadDeployConfig(env: DeployEnv, rootDir = process.cwd()): ResolvedDeployConfig {
	const fileEnv = parseEnvFile(resolve(rootDir, `.env.${env}`));
	const pick = (key: string) => process.env[key] ?? fileEnv[key] ?? "";

	const hostname =
		pick("DEPLOY_MAINTENANCE_HOSTNAME") ||
		deployConfig.maintenance.hostname[env] ||
		routeHostname(resolve(rootDir, "wrangler.toml"), env);

	return {
		mode: (pick("DEPLOY_MODE") || deployConfig.mode) as DeployMode,
		branch: pick("DEPLOY_BRANCH") || deployConfig.branches[env],
		notifyEmail: pick("DEPLOY_NOTIFY_EMAIL") || deployConfig.notifyEmail,
		maintenance: {
			mechanism: (pick("DEPLOY_MAINTENANCE_MECHANISM") ||
				deployConfig.maintenance.mechanism) as MaintenanceMechanism,
			zoneId: pick("DEPLOY_MAINTENANCE_ZONE_ID") || deployConfig.maintenance.zoneId,
			hostname,
			redirectTo: pick("DEPLOY_MAINTENANCE_REDIRECT_TO") || deployConfig.maintenance.redirectTo,
			bypassPaths: deployConfig.maintenance.bypassPaths,
		},
	};
}

/**
 * Cloudflare credentials for zone-level work. Kept out of `.env.<environment>`
 * on purpose, exactly like `bin/sync-build-vars.ts` does, so they never end up
 * synced into the Worker.
 */
export function cloudflareCredentials(rootDir = process.cwd()): { token: string; accountId: string } {
	const setup = parseEnvFile(resolve(rootDir, ".env.setup.local"));
	return {
		token: process.env.CLOUDFLARE_API_TOKEN ?? setup.CLOUDFLARE_API_TOKEN ?? "",
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? setup.CLOUDFLARE_ACCOUNT_ID ?? "",
	};
}
