import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// Worker integration tests run inside workerd with the real wrangler.toml
// bindings (D1, Durable Objects) and the project migrations applied.
// Kept separate from vite.config.ts so tests don't load the dev/build plugin.
export default defineConfig(async () => {
	const migrations = await readD1Migrations(path.resolve(__dirname, "migrations"));

	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.toml" },
				// wrangler.toml marks EMAIL as remote=true for local dev; tests must stay offline.
				remoteBindings: false,
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						ENVIRONMENT: "test",
						CLI_API_KEY: "test-cli-key",
					},
				},
			}),
		],
		resolve: {
			alias: { "@": path.resolve(__dirname, "./src/react-app") },
		},
		test: {
			include: ["test/**/*.test.ts"],
			setupFiles: ["./test/apply-migrations.ts"],
		},
	};
});
