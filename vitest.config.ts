import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

const alias = { "@": path.resolve(import.meta.dirname, "./src/react-app") };

// Two projects:
//  - worker:   runs inside workerd with the real wrangler.toml bindings (D1, Durable Objects)
//  - cross-db: runs in Node against PostgreSQL (PGlite always; real servers when TEST_*_URL is set)
//              and MySQL, using the same behavioural suite as the D1 run.
// Kept separate from vite.config.ts so tests don't load the dev/build plugin.
export default defineConfig({
	test: {
		// Better Auth 1.7 leaves the 401 APIError of a refused sign-in as a rejected promise that the Workers pool
		// reports as unhandled, although the HTTP response is correct (the dev server logs nothing). Ignore only that error.
		onUnhandledError: (error) => (error as { body?: { code?: string } }).body?.code === "INVALID_EMAIL_OR_PASSWORD" ? false : undefined,
		projects: [
			{
				plugins: [
					cloudflareTest({
						wrangler: { configPath: "./wrangler.toml" },
						// wrangler.toml marks EMAIL as remote=true for local dev; tests must stay offline.
						remoteBindings: false,
						miniflare: {
							// Extra empty D1 databases for isolated migration tests.
							d1Databases: ["DB2", "DB3"],
							bindings: { ENVIRONMENT: "test", CLI_API_KEY: "test-cli-key" },
						},
					}),
				],
				resolve: { alias },
				test: {
					name: "worker",
					include: ["test/**/*.test.ts"],
					exclude: ["test/cross-db/**"],
					setupFiles: ["./test/apply-migrations.ts"],
				},
			},
			{
				resolve: { alias },
				test: {
					name: "cross-db",
					include: ["test/cross-db/**/*.test.ts"],
					environment: "node",
					testTimeout: 60_000,
					hookTimeout: 60_000,
				},
			},
		],
	},
});
