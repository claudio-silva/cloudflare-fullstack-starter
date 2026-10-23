#!/usr/bin/env tsx
/**
 * Push the build-time variables from .env.<environment> to the Cloudflare
 * Workers Builds trigger(s) of the target Worker, so CI builds see the same
 * values as a local build.
 *
 * What counts as a build variable:
 *   - plain:  every `VITE_*` key (public by definition — it is inlined into the
 *             client bundle) and `CLI_API_URL*` (the public URL migrations call);
 *   - secret: `CLI_API_KEY` (write-only in the dashboard), because migrations run
 *             through the deployed Worker and CI must be able to call it.
 * Every other key is a runtime secret and goes through `bin/sync-secrets.ts`.
 *
 * The developer holding the .env files is the source of truth: values present
 * in the file overwrite the cloud ones; keys absent from the file are left
 * untouched on Cloudflare (the API cannot delete through PATCH).
 *
 * Credentials (never read from .env.<env>, to keep them out of the Worker):
 *   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, from the process environment
 *   or from .env.setup.local (gitignored via `*.local`). The token must be a
 *   *user* API token with "Workers Builds Configuration: Edit" (a.k.a. Workers CI
 *   Write) and "Workers Scripts: Read". See docs/DEPLOYMENT.md.
 *
 * Usage:
 *   tsx bin/sync-build-vars.ts <environment> [--config <wrangler.toml>] [--wrangler-env <name>]
 *                              [--dry-run] [--force]
 *
 * No token, no Workers Builds project yet, or no matching keys → a notice and exit 0.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CF_API = "https://api.cloudflare.com/client/v4";
const HASH_DIR = ".wrangler/build-vars";
const SETUP_ENV_FILE = ".env.setup.local";

function parseEnvFile(filePath: string): Record<string, string> {
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

const SECRET_BUILD_KEYS = new Set(["CLI_API_KEY"]);
const isBuildKey = (key: string) => key.startsWith("VITE_") || key.startsWith("CLI_API_URL") || SECRET_BUILD_KEYS.has(key);

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
}

/**
 * Worker name for the wrangler env: `[env.<env>] name = "..."` if set, else wrangler's own
 * default `<top-level name>-<env>` (which is also what vite.config.ts bakes into the build).
 */
function resolveWorkerName(configPath: string, wranglerEnv: string): string {
	const content = readFileSync(configPath, "utf-8");
	const envStart = content.indexOf(`[env.${wranglerEnv}]`);
	if (envStart !== -1) {
		const rest = content.slice(envStart + `[env.${wranglerEnv}]`.length);
		const next = rest.search(/^\s*\[/m);
		const block = next === -1 ? rest : rest.slice(0, next);
		const m = block.match(/^\s*name\s*=\s*"([^"]+)"/m);
		if (m) return m[1];
	}
	const top = content.match(/^name\s*=\s*"([^"]+)"/m);
	if (!top) throw new Error(`No Worker name found in ${configPath}`);
	return `${top[1]}-${wranglerEnv}`;
}

async function cf<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${CF_API}${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = (await res.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { message: string }[] } | null;
	if (!res.ok || !json?.success) {
		const detail = json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
		throw new Error(`${method} ${path}: ${detail}`);
	}
	return json.result as T;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const positionals = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--config", "--wrangler-env"].includes(args[i - 1])));
	const env = positionals[0];
	if (!env) {
		console.error("Usage: tsx bin/sync-build-vars.ts <environment> [--config <wrangler.toml>] [--wrangler-env <name>] [--dry-run] [--force]");
		process.exit(1);
	}
	const configPath = flag(args, "--config") ?? "wrangler.toml";
	const wranglerEnv = flag(args, "--wrangler-env") ?? env;
	const dryRun = args.includes("--dry-run");
	const force = args.includes("--force");

	const envFile = `.env.${env}`;
	if (!existsSync(envFile)) {
		console.log(`No ${envFile} file found, skipping build variables sync.`);
		return;
	}
	const vars = Object.fromEntries(Object.entries(parseEnvFile(envFile)).filter(([k, v]) => isBuildKey(k) && v));
	const keys = Object.keys(vars);
	if (keys.length === 0) {
		console.log(`No build variables (VITE_*, CLI_API_URL*, CLI_API_KEY) in ${envFile}; nothing to sync.`);
		return;
	}

	const hash = createHash("sha256").update(JSON.stringify(vars, Object.keys(vars).sort())).digest("hex");
	const hashFile = join(HASH_DIR, `${env}.hash`);
	if (!force && !dryRun && existsSync(hashFile) && readFileSync(hashFile, "utf-8").trim() === hash) {
		console.log(`✓ Build variables for ${env} are up to date (no changes detected)`);
		return;
	}

	const workerName = resolveWorkerName(configPath, wranglerEnv);
	console.log(`Build variables for ${workerName}: ${keys.map((k) => (SECRET_BUILD_KEYS.has(k) ? `${k} (secret)` : k)).join(", ")}`);
	if (dryRun) {
		console.log("(dry run — nothing sent)");
		return;
	}

	const setup = parseEnvFile(SETUP_ENV_FILE);
	const token = process.env.CLOUDFLARE_API_TOKEN || setup.CLOUDFLARE_API_TOKEN;
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || setup.CLOUDFLARE_ACCOUNT_ID;
	if (!token || !accountId) {
		console.log(`Skipping: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set (env or ${SETUP_ENV_FILE}). See docs/DEPLOYMENT.md.`);
		return;
	}

	const scripts = await cf<{ id: string; tag?: string }[]>(token, "GET", `/accounts/${accountId}/workers/scripts`);
	const script = scripts.find((s) => s.id === workerName);
	if (!script?.tag) {
		console.log(`Skipping: Worker "${workerName}" not found on this account (not deployed yet).`);
		return;
	}
	const triggers = await cf<{ trigger_uuid: string; trigger_name: string }[]>(
		token,
		"GET",
		`/accounts/${accountId}/builds/workers/${script.tag}/triggers`,
	);
	if (!triggers.length) {
		console.log(`Skipping: "${workerName}" has no Workers Builds trigger yet (connect the repo in the dashboard first).`);
		return;
	}

	const body = Object.fromEntries(keys.map((k) => [k, { is_secret: SECRET_BUILD_KEYS.has(k), value: vars[k] }]));
	for (const t of triggers) {
		await cf(token, "PATCH", `/accounts/${accountId}/builds/triggers/${t.trigger_uuid}/environment_variables`, body);
		console.log(`  ✓ ${t.trigger_name}`);
	}
	mkdirSync(HASH_DIR, { recursive: true });
	writeFileSync(hashFile, hash);
	console.log("✓ Build variables synced");
}

main().catch((err: unknown) => {
	console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
