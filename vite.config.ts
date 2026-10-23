import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare, type WorkerConfig } from "@cloudflare/vite-plugin";
import path from "path";
import fs from "node:fs";
import { parse as parseToml } from "smol-toml";
import { resolveBuildInfo } from "./bin/lib/build-info";

type AnyRecord = Record<string, unknown>;

/**
 * Keys that `wrangler` does NOT inherit from the top level into `[env.*]`.
 * Leaving one of these defined only at the top level is almost always a bug:
 * the deploy silently uses the top-level value (for example `database_id =
 * "local"`) for every environment. We warn rather than fail, because a few
 * projects legitimately share one binding across environments.
 */
const NON_INHERITABLE_KEYS = [
	"vars",
	"d1_databases",
	"kv_namespaces",
	"r2_buckets",
	"durable_objects",
	"queues",
	"send_email",
	"services",
	"hyperdrive",
	"vectorize",
	"ai",
	"workflows",
	"browser",
	"analytics_engine_datasets",
	"mtls_certificates",
	"pipelines",
	"version_metadata",
] as const;

/**
 * Build a config customizer that applies `[env.<name>]` from wrangler.toml on
 * top of the flat config the Cloudflare plugin generates.
 *
 * Background: @cloudflare/vite-plugin writes `dist/<name>/wrangler.json` as a
 * FLAT file with no `[env.*]` sections, so `wrangler deploy --env production`
 * has nothing to act on and the deploy would use the top-level config. The fix
 * is to bake the per-environment values into the generated file at build time.
 *
 * This merge is generic on purpose: every key under `[env.<name>]` is copied
 * across, whatever it is. Earlier revisions hand-parsed one key at a time,
 * which meant any binding nobody had thought of was dropped from the deploy
 * without a word — that is how the cron-trigger gap was found. Adding a new
 * binding to wrangler.toml now needs no change here.
 */
function createEnvCustomizer(tomlPath: string, env: "preview" | "production") {
	const root = parseToml(fs.readFileSync(tomlPath, "utf-8")) as AnyRecord;
	const envs = (root.env ?? {}) as AnyRecord;
	const block = (envs[env] ?? {}) as AnyRecord;
	const baseName = typeof root.name === "string" ? root.name : "app";

	for (const key of NON_INHERITABLE_KEYS) {
		if (key in root && !(key in block)) {
			console.warn(
				`[wrangler-env] "${key}" is set at the top level of wrangler.toml but not under [env.${env}]. ` +
					`The ${env} deploy will use the top-level value — confirm that is intended.`,
			);
		}
	}

	// Mutating form (returns void) so array fields such as d1_databases are
	// replaced wholesale instead of appended to.
	return (cfg: WorkerConfig): void => {
		const target = cfg as unknown as AnyRecord;
		target.name = typeof block.name === "string" ? block.name : `${baseName}-${env}`;
		for (const [key, value] of Object.entries(block)) {
			if (key === "name") continue;
			target[key] = value;
		}
	};
}

export default defineConfig(({ mode }) => {
	const buildInfo = resolveBuildInfo(__dirname);
	const tomlPath = path.resolve(__dirname, "wrangler.toml");
	const configCustomizer =
		mode === "preview" || mode === "production" ? createEnvCustomizer(tomlPath, mode) : undefined;

	return {
		plugins: [
			react(),
			cloudflare({
				remoteBindings: false,
				...(configCustomizer ? { config: configCustomizer } : {}),
			}),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src/react-app"),
			},
		},
		// Release version (package.json) and commit, read by src/shared/app-version.ts.
		define: {
			__APP_VERSION__: JSON.stringify(buildInfo.version),
			__APP_COMMIT__: JSON.stringify(buildInfo.commit),
		},
		// Avoid ELOOP when `.claude/AGENTS.md` is a broken self-symlink (Cursor/Claude hook).
		server: {
			watch: {
				ignored: [path.resolve(__dirname, ".claude")],
			},
		},
	};
});
