import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare, type WorkerConfig } from "@cloudflare/vite-plugin";
import path from "path";
import fs from "node:fs";

// Parse fields needed for environment-specific deployment from wrangler.toml.
//
// Background: @cloudflare/vite-plugin generates dist/<name>/wrangler.json as a
// flat file (no [env.*] sections). Passing --env to `wrangler deploy` has no
// effect on that generated file, so deployments always use the base config
// (database_id "local"). The fix is to bake the correct per-env values into
// the generated wrangler.json at build time via the plugin's config customizer.
function parseWranglerToml(filePath: string) {
	const content = fs.readFileSync(filePath, "utf-8");

	const baseName = content.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "app";

	const previewDb = {
		name: content.match(/\[\[env\.preview\.d1_databases\]\][^\[]*database_name\s*=\s*"([^"]+)"/s)?.[1] ?? `${baseName}-preview`,
		id: content.match(/\[\[env\.preview\.d1_databases\]\][^\[]*database_id\s*=\s*"([^"]+)"/s)?.[1] ?? "",
	};

	const productionDb = {
		name: content.match(/\[\[env\.production\.d1_databases\]\][^\[]*database_name\s*=\s*"([^"]+)"/s)?.[1] ?? baseName,
		id: content.match(/\[\[env\.production\.d1_databases\]\][^\[]*database_id\s*=\s*"([^"]+)"/s)?.[1] ?? "",
	};

	return { baseName, previewDb, productionDb };
}

export default defineConfig(({ mode }) => {
	const { baseName, previewDb, productionDb } = parseWranglerToml(
		path.resolve(__dirname, "wrangler.toml"),
	);

	// Use the mutating function form (returning void) so that array fields like
	// d1_databases are replaced rather than appended, avoiding duplicate entries.
	const configCustomizer =
		mode === "preview"
			? (cfg: WorkerConfig): void => {
					cfg.name = `${baseName}-preview`;
					cfg.vars = { ENVIRONMENT: "preview" };
					cfg.d1_databases = [
						{
							binding: "DB",
							database_name: previewDb.name,
							database_id: previewDb.id,
						},
					];
				}
			: mode === "production"
				? (cfg: WorkerConfig): void => {
						cfg.name = baseName;
						cfg.vars = { ENVIRONMENT: "production" };
						cfg.d1_databases = [
							{
								binding: "DB",
								database_name: productionDb.name,
								database_id: productionDb.id,
							},
						];
					}
				: undefined;

	return {
		plugins: [
			react(),
			cloudflare(configCustomizer ? { config: configCustomizer } : {}),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src/react-app"),
			},
		},
	};
});
