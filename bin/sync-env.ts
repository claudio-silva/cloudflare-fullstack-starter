#!/usr/bin/env tsx
/**
 * Send what changed in .env.<environment> to Cloudflare: the build variables
 * (bin/sync-build-vars.ts) and the Worker's secrets (bin/sync-secrets.ts).
 *
 * A deploy from this machine, `deploy:production` in every mode and `setup:ci`
 * already do it. What is left is a CI deploy nobody starts from here: a push
 * to the preview branch. Run it after editing .env.preview, before the push.
 *
 * Usage: npm run sync-env -- <environment> [--force]
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const env = args.find((a) => !a.startsWith("--"));
if (!env) {
	console.error("Usage: npm run sync-env -- <environment> [--force]");
	process.exit(1);
}
const force = args.includes("--force") ? ["--force"] : [];
for (const script of ["bin/sync-build-vars.ts", "bin/sync-secrets.ts"]) {
	if (spawnSync("npx", ["tsx", script, env, ...force], { stdio: "inherit" }).status !== 0) process.exit(1);
}
