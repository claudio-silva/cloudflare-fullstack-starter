/**
 * The deployed Worker of an environment: its name, and whether it exists yet.
 * Shared by the deploy pipeline (first deploy), sync-build-vars and setup-ci.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Worker name for the wrangler env: `[env.<env>] name = "..."` if set, else wrangler's own
 * default `<top-level name>-<env>` (which is also what vite.config.ts bakes into the build).
 */
export function resolveWorkerName(configPath: string, wranglerEnv: string): string {
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

/**
 * Does the Worker exist on the account? Asked of the Cloudflare API through
 * wrangler (so it uses whatever credentials the deploy uses). True or false
 * only when the answer is certain; undefined when the question failed for
 * another reason (no credentials, network), which callers must not read as "no".
 */
export function workerExists(name: string): boolean | undefined {
	try {
		execFileSync("npx", ["wrangler", "deployments", "list", "--name", name, "--json"], { stdio: "pipe" });
		return true;
	} catch (error) {
		const e = error as { stdout?: Buffer; stderr?: Buffer };
		const output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
		return /code: 10007\b|does not exist on your account/.test(output) ? false : undefined;
	}
}
